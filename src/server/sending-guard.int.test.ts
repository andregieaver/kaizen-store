import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const guard = await import("./sending-guard");
const { applyEmailEvent } = await import("./email-events");
const { startBroadcast, SENDING_PAUSED } = await import("./broadcasts");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let otherId: string;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

/** `n` emails of a kind as the sender keeps them, each with its own provider reference. */
async function emails(store: string, kind: string, n: number, status = "delivered") {
  for (let i = 0; i < n; i++) {
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, provider_reference)
      values (${store}::uuid, ${kind}, ${`p${i}@example.com`}, 'News', '<p>x</p>', 'x', ${status}::commerce.email_status, ${`ref-${store}-${kind}-${status}-${i}`})
    `);
  }
}

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`guard-${run}@example.com`}, 'Kari Nordmann', false) returning id, email`);
  owner = { id: String(acc.id), email: String(acc.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  storeId = await makeStore(`guard-${run}`);
  otherId = await makeStore(`guard-other-${run}`);
});

afterAll(async () => {
  await closeDb();
});

describe("the sending guard (D730)", () => {
  it("counts only marketing email, and judges nothing below the smallest send", async () => {
    await emails(storeId, "order.confirmation", 300, "bounced");
    await emails(storeId, "marketing.broadcast", 90);
    await emails(storeId, "marketing.broadcast", 10, "bounced");
    const health = await guard.sendingHealth(storeId);
    expect(health.counts).toEqual({ sent: 100, bounced: 10, complained: 0 });
    expect(health.verdict).toEqual({ level: "pause", reason: "bounces" });
    expect(health.pause).toBeNull();
  });

  it("pauses the store when a bounce on its marketing email passes the line, and tells its owners once", async () => {
    expect(await applyEmailEvent({ type: "email.bounced", data: { email_id: `ref-${storeId}-marketing.broadcast-bounced-0`, bounce: { type: "Transient" } } })).toBe(true);
    expect(await guard.isPaused(storeId)).toBe(true);
    expect(await guard.isPaused(otherId)).toBe(false);
    const health = await guard.sendingHealth(storeId);
    expect(health.pause).toMatchObject({ reason: "bounces", counts: { sent: 100, bounced: 10, complained: 0 } });

    // A second bounce leaves the pause as it is and sends no second email.
    await applyEmailEvent({ type: "email.bounced", data: { email_id: `ref-${storeId}-marketing.broadcast-bounced-1`, bounce: { type: "Transient" } } });
    const told = await db().execute<Row>(sql`select to_address from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'marketing.paused'`);
    expect(told.map((r) => r.to_address)).toEqual([owner.email]);
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = 'marketing.sending_paused'`);
    expect(Number(audit.n)).toBe(1);
    expect((await guard.pausedStores()).map((p) => p.storeId)).toContain(storeId);
  });

  it("holds broadcasts while paused", async () => {
    const [b] = await db().execute<Row>(sql`
      insert into commerce.broadcasts (store_id, title, audience, content) values (${storeId}::uuid, 'News', 'everyone', '{}'::jsonb) returning id
    `);
    expect(await startBroadcast(storeId, owner.id, String(b.id))).toEqual({ ok: false, problem: SENDING_PAUSED });
  });

  it("resumes on the owner's word and counts afresh from then", async () => {
    expect(await guard.resumeSending(owner, storeId)).toBe(true);
    expect(await guard.isPaused(storeId)).toBe(false);
    expect(await guard.resumeSending(owner, storeId)).toBe(false);
    const health = await guard.sendingHealth(storeId);
    expect(health.counts.sent).toBe(0);
    expect(health.verdict).toEqual({ level: "ok" });
    // The old bounces no longer pause it.
    expect(await guard.guardStore(storeId)).toBe("ok");
  });

  it("pauses again on spam reports after a resume, writing over the old pause", async () => {
    await emails(storeId, "marketing.automation", 199);
    await emails(storeId, "marketing.automation", 1, "complained");
    expect(await guard.guardStore(storeId)).toBe("paused");
    expect((await guard.sendingHealth(storeId)).pause).toMatchObject({ reason: "complaints" });
    const [rows] = await db().execute<Row>(sql`select count(*)::int as n from commerce.sending_pauses where store_id = ${storeId}::uuid`);
    expect(Number(rows.n)).toBe(1);
  });
});
