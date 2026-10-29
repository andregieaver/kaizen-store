import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { keepStripeWebhooksCurrent } = await import("./stripe-endpoints");

/** Kaizena Flow's Stripe endpoints follow the site's address (consolidation, 29 October 2026): Stripe follows no redirect. */

type Row = Record<string, unknown>;
let saved: Row[] = [];
const before = process.env.SITE_URL;

beforeAll(async () => {
  saved = await db().execute<Row>(sql`select * from commerce.platform_webhooks where provider = 'stripe' and mode = 'test'`);
  await db().execute(sql`delete from commerce.platform_webhooks where provider = 'stripe' and mode = 'test'`);
  for (const [kind, path] of [["snapshot", "connect/test"], ["thin", "connect/test/accounts"], ["billing", "billing/test"]]) {
    await db().execute(sql`
      insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext)
      values ('stripe', 'test', ${kind}, ${`we_${kind}_${randomBytes(4).toString("hex")}`}, ${`https://old.example.com/api/stripe/${path}`}, 'sealed')
    `);
  }
});

afterAll(async () => {
  process.env.SITE_URL = before;
  await db().execute(sql`delete from commerce.platform_webhooks where provider = 'stripe' and mode = 'test'`);
  for (const r of saved) {
    await db().execute(sql`
      insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext, updated_by)
      values ('stripe', 'test', ${String(r.kind)}, ${String(r.endpoint_id)}, ${String(r.url)}, ${String(r.secret_ciphertext)}, ${(r.updated_by as string | null) ?? null})
    `);
  }
  await closeDb();
});

describe("keepStripeWebhooksCurrent", () => {
  it("moves each endpoint on another address to the site's own, once, the account destination through its own call", async () => {
    process.env.SITE_URL = "https://kaizenaflow.com";
    const moves: string[] = [];
    const movers = () => ({
      endpoint: async (id: string, url: string) => void moves.push(`endpoint ${id.split("_")[1]} ${url}`),
      destination: async (id: string, url: string) => void moves.push(`destination ${id.split("_")[1]} ${url}`),
    });
    expect(await keepStripeWebhooksCurrent(movers)).toBe(3);
    expect(moves.sort()).toEqual([
      "destination thin https://kaizenaflow.com/api/stripe/connect/test/accounts",
      "endpoint billing https://kaizenaflow.com/api/stripe/billing/test",
      "endpoint snapshot https://kaizenaflow.com/api/stripe/connect/test",
    ]);
    const rows = await db().execute<Row>(sql`select url from commerce.platform_webhooks where provider = 'stripe' and mode = 'test' order by kind`);
    expect(rows.every((r) => String(r.url).startsWith("https://kaizenaflow.com/"))).toBe(true);
    // Already there: nothing moves again.
    expect(await keepStripeWebhooksCurrent(movers)).toBe(0);
  });

  it("keeps the row as it was when Stripe refuses, and moves nothing from a preview's address", async () => {
    await db().execute(sql`update commerce.platform_webhooks set url = 'https://old.example.com/api/stripe/billing/test' where provider = 'stripe' and mode = 'test' and kind = 'billing'`);
    const refusing = () => ({
      endpoint: async () => {
        throw new Error("No such webhook endpoint");
      },
      destination: async () => undefined,
    });
    expect(await keepStripeWebhooksCurrent(refusing)).toBe(0);
    const [row] = await db().execute<Row>(sql`select url from commerce.platform_webhooks where provider = 'stripe' and mode = 'test' and kind = 'billing'`);
    expect(row.url).toBe("https://old.example.com/api/stripe/billing/test");
    process.env.SITE_URL = "https://kaizen-store-git-main.vercel.app";
    const never = () => {
      throw new Error("no mover may be asked");
    };
    expect(await keepStripeWebhooksCurrent(never)).toBe(0);
  });
});
