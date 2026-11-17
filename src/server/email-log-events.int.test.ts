import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { applyEmailEvent } = await import("./email-events");
const { runBroadcasts } = await import("./broadcasts");
const { guardStore } = await import("./sending-guard");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId: string;

/** The events the log holds for the store, by name, oldest first. */
async function logged(event: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`select subject_id from commerce.events where store_id = ${storeId}::uuid and event = ${event} order by id`);
  return rows.map((r) => String(r.subject_id));
}

async function email(kind: string, ref: string, status = "delivered"): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, provider_reference)
    values (${storeId}::uuid, ${kind}, ${`${ref}@example.com`}, 'S', 'x', 'x', ${status}::commerce.email_status, ${ref})
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`events-${run}@example.com`}, 'Kari', false) returning email`);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${String(acc.email)}, 'Owner', ${`events-${run}`}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`events-${run}`}, ${`events-${run}`}, null) as id`);
  storeId = String(id);
});

afterAll(async () => {
  await closeDb();
});

describe("email on the event log (D732)", () => {
  it("logs a store's email that bounces or is marked as spam, once each", async () => {
    const order = await email("order.confirmation", `b-${run}`);
    expect(await applyEmailEvent({ type: "email.bounced", data: { email_id: `b-${run}`, bounce: { type: "Permanent", message: "No such user" } } })).toBe(true);
    // Resend may tell twice: the log holds it once.
    await applyEmailEvent({ type: "email.bounced", data: { email_id: `b-${run}`, bounce: { type: "Permanent" } } });
    expect(await logged("email.bounced")).toEqual([order]);

    const news = await email("marketing.broadcast", `c-${run}`);
    await applyEmailEvent({ type: "email.complained", data: { email_id: `c-${run}` } });
    await applyEmailEvent({ type: "email.complained", data: { email_id: `c-${run}` } });
    expect(await logged("email.complained")).toEqual([news]);
  });

  it("logs nothing for Kaizena Flow's own emails", async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status, provider_reference)
      values (null, 'account.sign_in', 'staff@example.com', 'S', 'x', 'x', 'sent', ${`p-${run}`}) returning id
    `);
    await applyEmailEvent({ type: "email.bounced", data: { email_id: `p-${run}`, bounce: { type: "Permanent" } } });
    const rows = await db().execute<Row>(sql`select 1 from commerce.events where subject_id = ${String(row.id)}::uuid`);
    expect(rows).toHaveLength(0);
  });

  it("logs a broadcast when it has finished sending", async () => {
    const [b] = await db().execute<Row>(sql`insert into commerce.broadcasts (store_id, title, audience, content) values (${storeId}::uuid, 'News', 'everyone', '{}'::jsonb) returning id`);
    await db().execute(sql`update commerce.broadcasts set status = 'sending', started_at = now(), recipient_count = 0 where id = ${String(b.id)}::uuid`);
    await runBroadcasts({ only: String(b.id), deadline: Date.now() + 5_000 });
    expect(await logged("broadcast.sent")).toEqual([String(b.id)]);
  });

  it("logs the sending guard's pause", async () => {
    for (let i = 0; i < 100; i++) await email("marketing.broadcast", `g-${run}-${i}`, i < 10 ? "bounced" : "delivered");
    expect(await guardStore(storeId)).toBe("paused");
    const [pause] = await db().execute<Row>(sql`select id from commerce.sending_pauses where store_id = ${storeId}::uuid`);
    expect(await logged("marketing.paused")).toEqual([String(pause.id)]);
  });
});
