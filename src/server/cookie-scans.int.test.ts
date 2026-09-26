import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { decodeConsent } from "@/lib/cookie-consent";

import type { Account } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { claimScan, latestFindings, listScans, requestScan, scanTarget } = await import("./cookie-scans");
const { runScan } = await import("./cookie-scan-runner");
const { listCookieNotes, saveCookieNote, siteCookies } = await import("./site-cookies");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let demoId: string;

beforeAll(async () => {
  // Scans are claimed across every site, so start from none.
  await db().execute(sql`delete from commerce.cookie_scans`);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`scan-${run}@example.com`}, 'Owner') returning id, email
  `);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
  const [store] = await db().execute<Row>(sql`
    insert into commerce.stores (slug, name, tracking) values (${`scan-${run}`}, 'Scan store', '{"ga4":"G-SCAN123"}') returning id
  `);
  storeId = String(store.id);
  const [demo] = await db().execute<Row>(sql`select id from commerce.stores where is_template`);
  demoId = String(demo.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.cookie_scans`);
  await closeDb();
});

describe("cookie scans (D58)", () => {
  it("queues one scan per site at a time, and runs asked-for scans before the schedule's", async () => {
    expect(await requestScan(owner, storeId)).toBe(true);
    expect(await requestScan(owner, storeId)).toBe(false);
    const first = await claimScan();
    expect(first?.storeId).toBe(storeId);
    // Running is still active: asking again does nothing.
    expect(await requestScan(owner, storeId)).toBe(false);

    // Then every open site never scanned, Kaizen's included; this store's
    // setup is not finished, so the schedule leaves it out.
    const scheduled: (string | null)[] = [];
    for (let i = 0; i < 200; i++) {
      const next = await claimScan();
      if (!next) break;
      scheduled.push(next.storeId);
    }
    expect(scheduled).toContain(null);
    expect(scheduled).toContain(demoId);
    expect(scheduled).not.toContain(storeId);
    expect(await claimScan()).toBeNull();
  });

  it("fails a scan left running, so the site can be scanned again", async () => {
    await db().execute(sql`
      update commerce.cookie_scans set started_at = now() - interval '11 minutes'
      where store_id = ${storeId}::uuid and status = 'running'
    `);
    await claimScan();
    const [scan] = await listScans(storeId, 1);
    expect(scan).toMatchObject({ status: "failed", error: "The scan stopped before it finished.", requestedBy: "Owner" });
    expect(await requestScan(owner, storeId)).toBe(true);
  });

  it("opens a store's markets, with a consent cookie allowing what the store asks about", async () => {
    expect(await scanTarget(crypto.randomUUID())).toBeNull();
    const demo = await scanTarget(demoId);
    expect(demo?.starts[0]).toMatch(/^\/s\/[a-z0-9-]+\/[a-z]{2}$/);
    expect(demo?.consent).toBeNull();
    expect(demo?.within(`${demo.starts[0]}/p/mug`)).toBe(true);
    expect(demo?.within("/blog")).toBe(false);

    await db().execute(sql`update commerce.platform_settings set tracking = '{"metaPixel":"123456789"}'::jsonb`);
    try {
      const kaizen = await scanTarget(null);
      expect(kaizen?.starts).toEqual(["/"]);
      expect(kaizen?.within("/blog")).toBe(true);
      expect(kaizen?.within("/s/demo/no")).toBe(false);
      expect(kaizen?.consent?.name).toBe("consent_kaizen");
      expect(decodeConsent(kaizen?.consent?.value)).toMatchObject({
        version: "marketing",
        choices: { preferences: true, statistics: true, marketing: true },
      });
    } finally {
      await db().execute(sql`update commerce.platform_settings set tracking = '{}'::jsonb`);
    }
  });

  it("records why a scan failed, and keeps the latest finished findings", async () => {
    const [queued] = await db().execute<Row>(sql`
      update commerce.cookie_scans set status = 'running', started_at = now()
      where store_id = ${demoId}::uuid and status in ('queued', 'running') returning id
    `);
    await runScan({ id: String(queued.id), storeId: demoId }, async () => {
      throw new Error("No browser here.");
    });
    const [failed] = await listScans(demoId, 1);
    expect(failed).toMatchObject({ status: "failed", error: "No browser here." });
    expect(await latestFindings(demoId)).toBeNull();

    const item = { kind: "cookie", name: "_ga", domain: "example.com", thirdParty: false, days: 730, beforeConsent: false, page: "/" };
    await db().execute(sql`
      insert into commerce.cookie_scans (store_id, status, started_at, finished_at, pages, items)
      values (${demoId}::uuid, 'done', now(), now(), '["/"]', ${JSON.stringify([item, { kind: "broken" }])}::jsonb)
    `);
    const latest = await latestFindings(demoId);
    expect(latest?.pages).toEqual(["/"]);
    expect(latest?.items).toEqual([item]);
  });

  it("lists what the scan found that Kaizen knows or the owner described, and asks about its categories", async () => {
    const found = (name: string, kind = "cookie", domain = "localhost") =>
      ({ kind, name, domain, thirdParty: domain !== "localhost", days: 90, beforeConsent: false, page: "/" });
    await db().execute(sql`
      insert into commerce.cookie_scans (store_id, status, started_at, finished_at, pages, items)
      values (${storeId}::uuid, 'done', now(), now(), '["/"]',
        ${JSON.stringify([found("_fbp"), found("_hjSession_1", "cookie", "hotjar.com"), found("widget", "localStorage")])}::jsonb)
    `);
    const before = await siteCookies(storeId, { ga4: "G-SCAN123" });
    // Analytics from the tool; marketing because the scan found Meta's cookie.
    expect(before.categories).toEqual(["statistics", "marketing"]);
    expect(before.cookies.map((c) => c.name)).toContain("_fbp");
    expect(before.cookies.map((c) => c.name)).not.toContain("_hjSession_1");

    const note = { kind: "cookie", name: "_hjSession_1", domain: "hotjar.com", category: "preferences", provider: "Hotjar", purpose: "Remembers a visit." };
    expect(await saveCookieNote(owner, storeId, { ...note, category: "tasty" })).toMatchObject({ ok: false });
    expect(await saveCookieNote(owner, storeId, note)).toEqual({ ok: true });
    expect(await saveCookieNote(owner, storeId, { ...note, category: "statistics" })).toEqual({ ok: true });
    expect(await listCookieNotes(storeId)).toEqual([{ ...note, category: "statistics" }]);

    const after = await siteCookies(storeId, {});
    expect(after.categories).toEqual(["statistics", "marketing"]);
    expect(after.cookies.find((c) => c.name === "_hjSession_1")).toMatchObject({
      provider: "Hotjar",
      category: "statistics",
      days: 90,
      purpose: { en: "Remembers a visit." },
    });
    // Kaizen's own site has its own notes.
    expect(await listCookieNotes(null)).toEqual([]);
  });
});
