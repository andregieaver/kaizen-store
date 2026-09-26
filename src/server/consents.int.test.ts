import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { recordConsent, listConsents } = await import("./consents");
const { saveTracking, siteCookies } = await import("./site-cookies");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const visitor = crypto.randomUUID();
let admin: Account;
let storeId: string;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`consent-${run}@example.com`}, 'Admin', true) returning id, email
  `);
  admin = { id: String(account.id), email: String(account.email), name: "Admin", platformAdmin: true };
  const [store] = await db().execute<Row>(sql`
    insert into commerce.stores (slug, name) values (${`consent-${run}`}, 'Consent store') returning id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.consents where visitor = ${visitor}::uuid`);
  await db().execute(sql`update commerce.platform_settings set tracking = '{}'::jsonb`);
  await closeDb();
});

describe("cookie consent (D58)", () => {
  it("records a visitor's choice for the site, and refuses what it cannot read", async () => {
    const choices = { preferences: false, statistics: true, marketing: false };
    expect(await recordConsent({ storeId, visitor, version: "statistics", choices })).toBe(true);
    expect(await recordConsent({ storeId: null, visitor, version: "", choices })).toBe(true);
    expect(await recordConsent({ storeId, visitor, version: "statistics", choices: { statistics: true } })).toBe(false);
    expect(await recordConsent({ storeId: crypto.randomUUID(), visitor, version: "statistics", choices })).toBe(false);
    expect(await recordConsent({ storeId, visitor: "me", version: "statistics", choices })).toBe(false);
    const log = await listConsents(storeId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ visitor, version: "statistics", choices });
  });

  it("saves a site's tools, which decide what visitors are asked and what the cookie page lists", async () => {
    expect(await saveTracking(admin, storeId, { ga4: "g-abc123", metaPixel: "not a pixel" })).toEqual({
      ok: false,
      problems: ["A Meta Pixel id is a number of 6 to 20 digits."],
    });
    expect(await saveTracking(admin, storeId, { ga4: "g-abc123", gtm: "", metaPixel: "" })).toEqual({
      ok: true,
      tracking: { ga4: "G-ABC123" },
    });
    expect((await getStore(`consent-${run}`))?.tracking).toEqual({ ga4: "G-ABC123" });
    const store = await siteCookies(storeId, { ga4: "G-ABC123" });
    expect(store.categories).toEqual(["statistics"]);
    expect(store.cookies.map((c) => c.name)).toEqual(["cart_…", "account_…", "wishlist_…", "consent_…", "_ga", "_ga_…"]);
    // Kaizen's own tools are kept apart.
    expect(await saveTracking(admin, null, { metaPixel: "1234567" })).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select tracking from commerce.platform_settings`);
    expect(row.tracking).toEqual({ metaPixel: "1234567" });
  });
});
