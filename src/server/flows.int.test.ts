import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { FlowStep } from "@/lib/flows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fl = await import("./flows");

type Row = Record<string, unknown>;

/**
 * Flows, slice 1 (D767, `docs/flows.md`), against a real database: a flow is refused with a problem in words, saved off, tested on the
 * newest subscriber and only then switched on; a trigger event in the log lets the person in once; each run moves on one step a turn,
 * through emails, waits and a branch the person's facts choose; an order ends it as a goal reached; someone who left the list is stopped.
 */

const run = Date.now().toString(36);
const HOUR = 3_600_000;
let storeId: string;
let owner: string;
let n = 0;

const email = (id: string, subject: string): FlowStep => ({
  id,
  kind: "email",
  content: { "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph", text: subject }] } },
});

const steps: FlowStep[] = [
  email("welcome", "Velkommen"),
  { id: "w1", kind: "wait", hours: 72 },
  { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("thanks", "Takk")], else: [email("best", "Bestselgere")] },
];

async function subscriber(address: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${address}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', now(), ${randomBytes(32).toString("base64url")})
    returning id
  `);
  return String(row.id);
}

async function paidOrder(address: string, at: Date): Promise<void> {
  n += 1;
  await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${storeId}::uuid, ${`fl${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${address}, 'paid', 10000, 0, 0, 2000, 10000, '{}'::jsonb, '{"name":"Ola"}'::jsonb,
        ${at.toISOString()}::timestamptz)
      returning id`);
    await tx.execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_fl${run}_${n}`}, 10000, 'NOK', 'captured')`);
  });
}

/** The person joins: the event the flow listens for, in the log. */
const joined = (subscriberId: string) => db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'subscriber.subscribed', ${subscriberId}::uuid)`);

const runOf = async (subscriberId: string) =>
  (await db().execute<Row>(sql`select id, path, status, wake_at from commerce.flow_runs where store_id = ${storeId}::uuid and subscriber_id = ${subscriberId}::uuid`))[0];
const stepsOf = async (runId: string) =>
  (await db().execute<Row>(sql`select step_id, outcome from commerce.flow_run_steps where run_id = ${runId}::uuid order by created_at`)).map((r) => [r.step_id, r.outcome]);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`flows-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`flows-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active', locales = array['nb-NO'] where id = ${storeId}::uuid`);
  // How often and when is the contact policy's (D764, contact-policy.int.test.ts); these tests are about the walk.
  await db().execute(sql`insert into commerce.contact_policies (store_id, per_week, spacing_hours, quiet_hours) values (${storeId}::uuid, 14, 0, false)`);
  const [m] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  owner = String(m.account_id);
  delete process.env.RESEND_API_KEY;
  // The reader starts where the log is now: anything before this file's own events is not a flow's.
  await fl.enterFlows();
});

afterAll(async () => {
  await closeDb();
});

describe("flows (D767)", () => {
  let flowId: string;

  it("refuses a flow with a problem in words, saves one off, and switches it on only once tested", async () => {
    expect(await fl.saveFlow(storeId, owner, null, { name: "Tom", trigger: "subscriber.subscribed", steps: [{ id: "w", kind: "wait", hours: 1 }], goals: [] })).toEqual({
      ok: false,
      problem: "A flow sends at least one email.",
    });
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Velkommen ${run}`, trigger: "subscriber.subscribed", steps, goals: [{ kind: "ordered" }] });
    if (!saved.ok) throw new Error(saved.problem);
    flowId = saved.id;
    expect(await fl.switchFlow(storeId, owner, flowId, true)).toBe("untested");
    await subscriber(`newest-${run}@example.com`);
    expect(await fl.testFlow(storeId, flowId)).toEqual({ ok: true, person: `newest-${run}@example.com`, emails: ["Velkommen", "Bestselgere"], ends: "done" });
    expect(await fl.switchFlow(storeId, owner, flowId, true)).toBe("ok");
    // A new save is a new version, off again until tested.
    const again = await fl.saveFlow(storeId, owner, flowId, { name: `Velkommen ${run}`, trigger: "subscriber.subscribed", steps, goals: [{ kind: "ordered" }] });
    expect(again).toMatchObject({ ok: true, version: 2 });
    expect((await fl.getFlow(storeId, flowId))?.enabled).toBe(false);
    await fl.testFlow(storeId, flowId);
    expect(await fl.switchFlow(storeId, owner, flowId, true)).toBe("ok");
  });

  it("lets a person in once from the event log, and walks them through emails, a wait and the branch their facts choose", async () => {
    const ola = await subscriber(`ola-${run}@example.com`);
    // Inserting the subscriber already logged the event; two more for the same person still make one run.
    await joined(ola);
    await joined(ola);
    await fl.enterFlows();
    const runs = await db().execute<Row>(sql`select id from commerce.flow_runs where store_id = ${storeId}::uuid and subscriber_id = ${ola}::uuid`);
    expect(runs).toHaveLength(1);
    const entered = await runOf(ola);
    expect(entered).toMatchObject({ status: "running" });

    const now = Date.now();
    await fl.runFlows({ only: storeId, now: new Date(now + 1000) });
    expect(await stepsOf(String(entered.id))).toEqual([["welcome", "logged"]]);
    await fl.runFlows({ only: storeId, now: new Date(now + 2000) });
    const waiting = await runOf(ola);
    expect(waiting.path).toBe("2");
    expect(new Date(String(waiting.wake_at)).getTime()).toBeGreaterThan(now + 71 * HOUR);
    // Not due yet: nothing happens.
    await fl.runFlows({ only: storeId, now: new Date(now + 3000) });
    expect(await stepsOf(String(entered.id))).toHaveLength(1);

    await fl.runFlows({ only: storeId, now: new Date(now + 73 * HOUR) });
    expect(await stepsOf(String(entered.id))).toEqual([
      ["welcome", "logged"],
      ["best", "logged"],
    ]);
    await fl.runFlows({ only: storeId, now: new Date(now + 73 * HOUR + 1000) });
    expect(await runOf(ola)).toMatchObject({ status: "done", path: null });
  });

  it("ends a run as a goal reached when the person orders", async () => {
    const kari = await subscriber(`kari-${run}@example.com`);
    await joined(kari);
    await fl.enterFlows();
    const now = Date.now();
    await fl.runFlows({ only: storeId, now: new Date(now + 1000) });
    await paidOrder(`kari-${run}@example.com`, new Date(now + 2000));
    await fl.runFlows({ only: storeId, now: new Date(now + 3000) });
    expect(await runOf(kari)).toMatchObject({ status: "goal" });
  });

  it("stops the run of someone who left the list", async () => {
    const nils = await subscriber(`nils-${run}@example.com`);
    await joined(nils);
    await fl.enterFlows();
    await db().execute(sql`update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribed_at = now(), unsubscribe_source = 'link' where id = ${nils}::uuid`);
    await fl.runFlows({ only: storeId, now: new Date(Date.now() + 1000) });
    expect(await runOf(nils)).toMatchObject({ status: "stopped" });
  });
});
