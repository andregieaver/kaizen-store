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

const email = (id: string, subject: string): Extract<FlowStep, { kind: "email" }> => ({
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

  it("switches off the automation a recipe does the work of, and keeps it off while the flow is on (slice 3)", async () => {
    const { welcomeSeries } = await import("@/lib/flow-recipes");
    const au = await import("./automations");
    await db().execute(sql`
      insert into commerce.automations (store_id, kind, enabled, enabled_at, delay_days, content)
      values (${storeId}::uuid, 'welcome', true, now(), 0, ${JSON.stringify({ "nb-NO": { subject: "Hei", preview: "", blocks: [{ type: "paragraph", text: "Hei" }] } })}::jsonb)
      on conflict (store_id, kind) do update set enabled = true, enabled_at = now()`);
    const saved = await fl.saveFlow(storeId, owner, null, welcomeSeries("nb-NO"));
    if (!saved.ok) throw new Error(saved.problem);
    expect((await fl.getFlow(storeId, saved.id))?.replaces).toBe("welcome");
    await fl.testFlow(storeId, saved.id);
    expect(await fl.switchFlow(storeId, owner, saved.id, true)).toBe("replaced");
    const [auto] = await db().execute<Row>(sql`select enabled from commerce.automations where store_id = ${storeId}::uuid and kind = 'welcome'`);
    expect(auto?.enabled).toBe(false);
    // A save keeps what it replaces; switching the automation back on is refused while the flow is on.
    await fl.saveFlow(storeId, owner, saved.id, { ...welcomeSeries("nb-NO"), replaces: undefined });
    expect((await fl.getFlow(storeId, saved.id))?.replaces).toBe("welcome");
    await fl.testFlow(storeId, saved.id);
    expect(await fl.switchFlow(storeId, owner, saved.id, true)).toBe("ok");
    const store = { id: storeId, localization: { locales: ["nb-NO"], keptLocales: ["nb-NO"] } } as Parameters<typeof au.switchAutomation>[0];
    expect(await au.switchAutomation(store, owner, "welcome", true)).toEqual({ ok: false, problem: "The flow \"Velkomstserie\" sends this now. Switch it off under Flows first." });
    expect(await fl.switchFlow(storeId, owner, saved.id, false)).toBe("ok");
  });

  it("enters a person once when their latest paid order is the lapse flow's days old, and not after a later order (slice 4)", async () => {
    const { winBack } = await import("@/lib/flow-recipes");
    const DAY = 24 * HOUR;
    const now = new Date();
    const kari = await subscriber(`lapsed-kari-${run}@example.com`);
    const per = await subscriber(`lapsed-per-${run}@example.com`);
    await paidOrder(`lapsed-kari-${run}@example.com`, new Date(now.getTime() - 91 * DAY));
    await paidOrder(`lapsed-per-${run}@example.com`, new Date(now.getTime() - 91 * DAY));
    await paidOrder(`lapsed-per-${run}@example.com`, new Date(now.getTime() - 10 * DAY));
    const saved = await fl.saveFlow(storeId, owner, null, winBack("nb-NO"));
    if (!saved.ok) throw new Error(saved.problem);
    expect(await fl.saveFlow(storeId, owner, null, { ...winBack("nb-NO"), triggerDays: null })).toMatchObject({ ok: false });
    await fl.testFlow(storeId, saved.id);
    await fl.switchFlow(storeId, owner, saved.id, true);
    // Switched on now: a lapse from yesterday is before it and enters nobody.
    expect(await fl.enterLapsed(now)).toBe(0);
    await db().execute(sql`update commerce.flows set enabled_at = ${new Date(now.getTime() - 2 * DAY).toISOString()}::timestamptz where id = ${saved.id}::uuid`);
    expect(await fl.enterLapsed(now)).toBe(1);
    expect(await fl.enterLapsed(now)).toBe(0);
    const entered = await db().execute<Row>(sql`select subscriber_id from commerce.flow_runs where flow_id = ${saved.id}::uuid`);
    expect(entered.map((r) => String(r.subscriber_id))).toEqual([kari]);
    expect(entered.map((r) => String(r.subscriber_id))).not.toContain(per);
    await fl.switchFlow(storeId, owner, saved.id, false);
  });

  it("enters the person an order.sent event's order is about, and a new trigger stops replacing an automation (slice 4)", async () => {
    const { ownFlow, welcomeSeries } = await import("@/lib/flow-recipes");
    const lise = await subscriber(`sent-lise-${run}@example.com`);
    await paidOrder(`sent-lise-${run}@example.com`, new Date());
    const [order] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${storeId}::uuid and email = ${`sent-lise-${run}@example.com`}`);
    const saved = await fl.saveFlow(storeId, owner, null, ownFlow("nb-NO"));
    if (!saved.ok) throw new Error(saved.problem);
    await fl.testFlow(storeId, saved.id);
    expect(await fl.switchFlow(storeId, owner, saved.id, true)).toBe("ok");
    await db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'order.sent', ${String(order.id)}::uuid)`);
    await fl.enterFlows();
    const runs = await db().execute<Row>(sql`select subscriber_id from commerce.flow_runs where flow_id = ${saved.id}::uuid`);
    expect(runs.map((r) => String(r.subscriber_id))).toEqual([lise]);
    await fl.switchFlow(storeId, owner, saved.id, false);
    // The welcome series moved to another trigger no longer does the welcome automation's work.
    const welcome = await fl.saveFlow(storeId, owner, null, welcomeSeries("nb-NO"));
    if (!welcome.ok) throw new Error(welcome.problem);
    await fl.saveFlow(storeId, owner, welcome.id, { ...welcomeSeries("nb-NO"), trigger: "order.sent", replaces: undefined });
    expect((await fl.getFlow(storeId, welcome.id))?.replaces).toBeNull();
  });

  it("skips a picked email for a reader with nothing to show, and goes on to the next step (slice 4)", async () => {
    const tove = await subscriber(`picks-tove-${run}@example.com`);
    await paidOrder(`picks-tove-${run}@example.com`, new Date(Date.now() - HOUR));
    const steps: FlowStep[] = [{ ...email("together", "Passer sammen"), picks: "cross_sell" }, email("plain", "Takk")];
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Picks ${run}`, trigger: "order.sent", steps, goals: [] });
    if (!saved.ok) throw new Error(saved.problem);
    await fl.testFlow(storeId, saved.id);
    await fl.switchFlow(storeId, owner, saved.id, true);
    const [order] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${storeId}::uuid and email = ${`picks-tove-${run}@example.com`}`);
    await db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'order.sent', ${String(order.id)}::uuid)`);
    await fl.enterFlows();
    const [entered] = await db().execute<Row>(sql`select id from commerce.flow_runs where flow_id = ${saved.id}::uuid and subscriber_id = ${tove}::uuid`);
    const later = Date.now() + 5000;
    await fl.runFlows({ only: storeId, now: new Date(later) });
    await fl.runFlows({ only: storeId, now: new Date(later + 1000) });
    // Nothing was bought with the order by anyone else: no products to show, so no email; the plain one still goes.
    expect(await stepsOf(String(entered.id))).toEqual([
      ["together", "suppressed"],
      ["plain", "logged"],
    ]);
    await fl.switchFlow(storeId, owner, saved.id, false);
  });

  it("enters a signed-in subscriber the browse flow's days after their latest view, not after an order, and keeps views only while it is on (slice 4)", async () => {
    const { browseReminder } = await import("@/lib/flow-recipes");
    const DAY = 24 * HOUR;
    const now = new Date();
    const address = `browse-eva-${run}@example.com`;
    const eva = await subscriber(address);
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${address}) returning id`);
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid limit 1`);
    const saved = await fl.saveFlow(storeId, owner, null, browseReminder("nb-NO"));
    if (!saved.ok) throw new Error(saved.problem);
    await fl.testFlow(storeId, saved.id);
    await fl.switchFlow(storeId, owner, saved.id, true);
    await db().execute(sql`update commerce.flows set enabled_at = ${new Date(now.getTime() - 3 * DAY).toISOString()}::timestamptz where id = ${saved.id}::uuid`);
    if (product) {
      await db().execute(sql`insert into commerce.customer_product_views (store_id, customer_id, product_id, viewed_at)
        values (${storeId}::uuid, ${String(customer.id)}::uuid, ${String(product.id)}::uuid, ${new Date(now.getTime() - 1.5 * DAY).toISOString()}::timestamptz)`);
      expect(await fl.enterBrowsed(now)).toBe(1);
      expect(await fl.enterBrowsed(now)).toBe(0);
      const [entered] = await db().execute<Row>(sql`select subscriber_id from commerce.flow_runs where flow_id = ${saved.id}::uuid`);
      expect(String(entered.subscriber_id)).toBe(eva);
    }
    // Switched off with no browse automation on: the views go (D691).
    await fl.switchFlow(storeId, owner, saved.id, false);
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customer_product_views where store_id = ${storeId}::uuid`);
    expect(left.n).toBe(0);
  });

  it("keeps a press on a flow email's link as the reader's, and the branch on pressing a link takes it (D754, D767)", async () => {
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const bc = await import("./broadcasts");
    const ida = await subscriber(`clicks-ida-${run}@example.com`);
    const withButton: FlowStep = {
      id: "look",
      kind: "email",
      content: { "nb-NO": { subject: "Se her", preview: "", blocks: [{ type: "paragraph", text: "Hei" }, { type: "button", text: "Se", url: "https://example.com/look" }] } },
    };
    const steps: FlowStep[] = [
      withButton,
      { id: "w", kind: "wait", hours: 1 },
      { id: "q", kind: "if", condition: { kind: "clicked_flow_email" }, then: [email("yes", "Takk for besøket")], else: [email("no", "Ikke sett")] },
    ];
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Clicks ${run}`, trigger: "subscriber.subscribed", steps, goals: [] });
    if (!saved.ok) throw new Error(saved.problem);
    await fl.testFlow(storeId, saved.id);
    await fl.switchFlow(storeId, owner, saved.id, true);
    await joined(ida);
    await fl.enterFlows();
    const [entered] = await db().execute<Row>(sql`select id from commerce.flow_runs where flow_id = ${saved.id}::uuid and subscriber_id = ${ida}::uuid`);
    const start = Date.now() + 5000;
    await fl.runFlows({ only: storeId, now: new Date(start) });
    // The reader presses the button, through the broadcasts' click route.
    const url = new URL(fl.flowClickUrl(saved.id, "look", "nb-NO.1", "no", ida));
    const key = decodeURIComponent(url.pathname.split("/").pop() ?? "");
    expect(await bc.recordClick(saved.id, key, "no", url.searchParams.get("p"))).toContain("example.com/look");
    expect(await bc.recordClick(saved.id, "look~nb-NO.9", "no", null)).toBeNull();
    // The wait begins when the run reaches it: it is passed an hour after that.
    await fl.runFlows({ only: storeId, now: new Date(start + 1000) });
    await fl.runFlows({ only: storeId, now: new Date(start + 2 * HOUR) });
    expect(await stepsOf(String(entered.id))).toEqual([
      ["look", "logged"],
      ["yes", "logged"],
    ]);
    await fl.switchFlow(storeId, owner, saved.id, false);
    vi.unstubAllEnvs();
  });

  it("says about how many people would start a flow, from the last 30 days, sending nothing (M3.5)", async () => {
    const before = await fl.flowReach(storeId, "subscriber.subscribed", null);
    const lone = await subscriber(`reach-lone-${run}@example.com`);
    await joined(lone);
    expect(await fl.flowReach(storeId, "subscriber.subscribed", null)).toBe(before + 1);
    // A paid order's event names its buyer on the list.
    const buyer = `reach-buyer-${run}@example.com`;
    await subscriber(buyer);
    await paidOrder(buyer, new Date());
    const [order] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${storeId}::uuid and email = ${buyer}`);
    const sentBefore = await fl.flowReach(storeId, "order.sent", null);
    await db().execute(sql`select commerce.queue_integration_event(${storeId}::uuid, 'order.sent', ${String(order.id)}::uuid)`);
    expect(await fl.flowReach(storeId, "order.sent", null)).toBe(sentBefore + 1);
    expect(await fl.flowReach(storeId, "customer.lapsed", 90)).toBeGreaterThanOrEqual(0);
  });

  it("draws each email for the newest subscriber as it would be sent, sending nothing (M3.5)", async () => {
    const steps: FlowStep[] = [email("hello", "Hei der"), { id: "w", kind: "wait", hours: 24 }, email("more", "Mer fra oss")];
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Drawn ${run}`, trigger: "subscriber.subscribed", steps, goals: [] });
    if (!saved.ok) throw new Error(saved.problem);
    const newest = `drawn-${run}@example.com`;
    await subscriber(newest);
    const drawn = await fl.drawFlowEmails(storeId, saved.id);
    expect(drawn.person).toBe(newest);
    expect(drawn.emails.map((e) => [e.stepId, e.subject])).toEqual([
      ["hello", "Hei der"],
      ["more", "Mer fra oss"],
    ]);
    expect(drawn.emails[0]?.html).toContain("Hei der");
    // Drawing marks nothing tested and starts nobody.
    expect((await fl.getFlow(storeId, saved.id))?.tested).toBe(false);
    const runs = await db().execute<Row>(sql`select id from commerce.flow_runs where flow_id = ${saved.id}::uuid`);
    expect(runs).toHaveLength(0);
  });

  it("reports the orders after its emails, credited to the step their buyer got last (M3.8, D761)", async () => {
    const address = `report-${run}@example.com`;
    const steps: FlowStep[] = [email("first", "Hei fra oss")];
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Report ${run}`, trigger: "subscriber.subscribed", steps, goals: [] });
    if (!saved.ok) throw new Error(saved.problem);
    await fl.testFlow(storeId, saved.id);
    await fl.switchFlow(storeId, owner, saved.id, true);
    const person = await subscriber(address);
    await joined(person);
    await fl.enterFlows();
    await fl.runFlows({ only: storeId, now: new Date() });
    await new Promise((r) => setTimeout(r, 50));
    await paidOrder(address, new Date());
    const report = await fl.flowReport(storeId, saved.id);
    // Earlier tests' sign-ups still in the log enter it too: each who entered got the email; only this buyer ordered after it.
    expect(report).toMatchObject({ orders: 1, topStep: { id: "first", orders: 1 }, left: 0 });
    expect(report.entered).toBeGreaterThanOrEqual(1);
    expect(report.sent).toBe(report.entered);
    expect(report.minor).toEqual({ NOK: 10000 });
    await fl.switchFlow(storeId, owner, saved.id, false);
  });

  it("reads its own past for each step's reach: ended ways through and how many came to each step, leaving running ones out (M3.5)", async () => {
    const steps: FlowStep[] = [email("a", "A"), { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("b", "B")], else: [] }];
    const saved = await fl.saveFlow(storeId, owner, null, { name: `Past ${run}`, trigger: "subscriber.subscribed", steps, goals: [] });
    if (!saved.ok) throw new Error(saved.problem);
    const way = async (address: string, status: string, reached: string[]) => {
      const person = await subscriber(address);
      const [r] = await db().execute<Row>(sql`
        insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, status, ended_at)
        values (${storeId}::uuid, ${saved.id}::uuid, 1, ${person}::uuid, ${address}, ${status}, ${status === "running" ? null : new Date().toISOString()}::timestamptz)
        returning id`);
      for (const step of reached)
        await db().execute(sql`insert into commerce.flow_run_steps (store_id, run_id, step_id, outcome) values (${storeId}::uuid, ${String(r.id)}::uuid, ${step}, 'logged')`);
    };
    await way(`past1-${run}@example.com`, "done", ["a", "b"]);
    await way(`past2-${run}@example.com`, "done", ["a"]);
    await way(`past3-${run}@example.com`, "running", ["a"]);
    const past = await fl.flowStepPast(storeId, saved.id);
    expect(past.ended).toBe(2);
    expect(Object.fromEntries(past.reached)).toEqual({ a: 2, b: 1 });
  });
});
