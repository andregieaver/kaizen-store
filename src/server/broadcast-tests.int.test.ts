
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { BroadcastContent } from "@/lib/broadcasts";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const bc = await import("./broadcasts");
const { storeById } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * A broadcast's split test against a real database (email plan M2.5, D868): too small an audience is refused with how many it needs;
 * the tested share is split evenly between A and B and the rest held; B's readers get B's subject; after the wait the engine's call
 * sends the held readers the winner, once; a stop skips the held ones too.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: string;

const content: BroadcastContent = {
  "nb-NO": { subject: "Høstnytt", preview: "", blocks: [{ type: "button", text: "Se nyhetene", url: "/products" }] },
};
const test = { b: { "nb-NO": { subject: "Høsten er her", preview: "" } }, share: 50, hours: 4 };

async function draft(title: string): Promise<string> {
  const store = await storeById(storeId);
  if (!store) throw new Error("no store");
  const saved = await bc.saveBroadcast(store, owner, null, { title, audience: "everyone", segmentId: null, content, test });
  if (!saved.ok) throw new Error(saved.problem);
  return saved.id;
}

async function subscribers(n: number, tag: string): Promise<void> {
  await db().execute(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    select ${storeId}::uuid, ${`${tag}-`} || g || ${`-${run}@example.com`}, 'nb-NO', 'NO', 'subscribed', 'account', 'Ja takk', now(),
           substr(md5(random()::text) || md5(random()::text), 1, 43)
      from generate_series(1, ${n}) g`);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`split-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`split-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO'] where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.contact_policies (store_id, per_week, spacing_hours, quiet_hours) values (${storeId}::uuid, 14, 0, false)`);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  delete process.env.RESEND_API_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("a broadcast's split test (D868)", () => {
  it("is refused on an audience too small to read, saying how many it needs", async () => {
    await subscribers(10, "few");
    const id = await draft("Too few");
    const started = await bc.startBroadcast(storeId, owner, id);
    expect(started).toEqual({ ok: false, problem: bc.testTooSmall(10, 50) });
    expect(bc.testTooSmall(10, 50)).toContain("800");
  });

  it("splits the tested share evenly, holds the rest, sends B its subject, and sends the rest the winner once the wait is over", async () => {
    await subscribers(790, "many");
    const id = await draft("Split");
    const started = await bc.startBroadcast(storeId, owner, id);
    expect(started).toEqual({ ok: true, recipients: 800 });
    const split = await db().execute<Row>(sql`
      select coalesce(version, '-') as version, status, count(*)::int as n from commerce.broadcast_recipients where broadcast_id = ${id}::uuid group by 1, 2 order by 1, 2`);
    expect(split.map((r) => `${r.version}:${r.status}:${r.n}`)).toEqual(["-:held:400", "a:queued:200", "b:queued:200"]);

    await bc.runBroadcasts({ only: id, pace: 0 });
    const subjects = await db().execute<Row>(sql`
      select r.version, e.subject, count(*)::int as n from commerce.broadcast_recipients r join commerce.email_messages e on e.id = r.email_message_id
       where r.broadcast_id = ${id}::uuid group by 1, 2 order by 1`);
    expect(subjects.map((r) => `${r.version}:${r.subject}:${r.n}`)).toEqual(["a:Høstnytt:200", "b:Høsten er her:200"]);
    // Still sending: the held readers wait for the call.
    expect(String((await db().execute<Row>(sql`select status from commerce.broadcasts where id = ${id}::uuid`))[0].status)).toBe("sending");

    // B's readers pressed clearly more.
    await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, broadcast_id, link)
      select r.store_id, r.subscriber_id, r.broadcast_id, 'nb-NO.0' from commerce.broadcast_recipients r
       where r.broadcast_id = ${id}::uuid and r.version = 'b' order by r.subscriber_id limit 60`);
    await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, broadcast_id, link)
      select r.store_id, r.subscriber_id, r.broadcast_id, 'nb-NO.0' from commerce.broadcast_recipients r
       where r.broadcast_id = ${id}::uuid and r.version = 'a' order by r.subscriber_id limit 20`);

    expect(await bc.callDueTests(new Date())).toBe(0);
    expect(await bc.callDueTests(new Date(Date.now() + 5 * 3_600_000))).toBe(1);
    expect(await bc.callDueTests(new Date(Date.now() + 5 * 3_600_000))).toBe(0);
    const called = await bc.getBroadcast(storeId, id);
    expect(called?.testResult).toMatchObject({ winner: "b", call: "b", a: { sent: 200, pressed: 20 }, b: { sent: 200, pressed: 60 } });
    const rest = await db().execute<Row>(sql`
      select coalesce(version, '-') as version, status, count(*)::int as n from commerce.broadcast_recipients where broadcast_id = ${id}::uuid group by 1, 2 order by 1, 2`);
    expect(rest.map((r) => `${r.version}:${r.status}:${r.n}`)).toEqual(["a:sent:200", "b:queued:400", "b:sent:200"]);
    await bc.runBroadcasts({ only: id, pace: 0 });
    expect(String((await db().execute<Row>(sql`select status from commerce.broadcasts where id = ${id}::uuid`))[0].status)).toBe("sent");
  });

  it("skips the held readers too when the send is stopped", async () => {
    const id = await draft("Stopped");
    await bc.startBroadcast(storeId, owner, id);
    expect(await bc.stopBroadcast(storeId, owner, id)).toBe(true);
    const left = await db().execute<Row>(sql`select count(*)::int as n from commerce.broadcast_recipients where broadcast_id = ${id}::uuid and status in ('queued', 'held')`);
    expect(left[0].n).toBe(0);
  });
});

describe("send time per person (M4.4)", () => {
  it("gives a reader who pressed links at 19 o'clock that hour, the rest the store's best hour, and refuses it with a test", async () => {
    const store = await storeById(storeId);
    if (!store) throw new Error("no store");
    const [sent] = await db().execute<Row>(sql`select id from commerce.broadcasts where store_id = ${storeId}::uuid and status = 'sent' limit 1`);
    const [reader] = await db().execute<Row>(sql`select id from commerce.marketing_subscribers where store_id = ${storeId}::uuid order by email limit 1`);
    for (const day of [1, 2, 3]) {
      await db().execute(sql`
        insert into commerce.email_clicks (store_id, subscriber_id, broadcast_id, link, clicked_at)
        values (${storeId}::uuid, ${String(reader.id)}::uuid, ${String(sent.id)}::uuid, 'nb-NO.0',
          (date_trunc('day', now() at time zone 'Europe/Oslo') - make_interval(days => ${day}) + interval '19 hours') at time zone 'Europe/Oslo')`);
    }
    const refused = await bc.saveBroadcast(store, owner, null, { title: "Both", audience: "everyone", segmentId: null, content, test, bestTime: true });
    expect(refused).toEqual({ ok: false, problem: bc.BEST_TIME_WITH_TEST });
    const saved = await bc.saveBroadcast(store, owner, null, { title: "Own hour", audience: "everyone", segmentId: null, content, bestTime: true });
    if (!saved.ok) throw new Error(saved.problem);
    expect((await bc.startBroadcast(storeId, owner, saved.id)).ok).toBe(true);
    // This store's earlier presses (80, in the test above) give it a best hour, which every reader without one of their own gets.
    const rows = await db().execute<Row>(sql`
      select subscriber_id, extract(hour from send_after at time zone 'Europe/Oslo')::int as hour
        from commerce.broadcast_recipients where broadcast_id = ${saved.id}::uuid`);
    expect(rows.find((r) => String(r.subscriber_id) === String(reader.id))?.hour).toBe(19);
    const others = new Set(rows.filter((r) => String(r.subscriber_id) !== String(reader.id)).map((r) => r.hour));
    expect(others.size).toBe(1);
    expect([...others][0]).not.toBeNull();
  });
});

