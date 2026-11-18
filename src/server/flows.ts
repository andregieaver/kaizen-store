import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { policyVerdict, type PolicyReason } from "@/lib/contact-policy";
import { FLOW_TRIGGERS } from "@/lib/flow-triggers";
import {
  advance,
  checkFlow,
  flowInputSchema,
  flowStepSchema,
  pathOf,
  pathText,
  type FlowFacts,
  type FlowGoal,
  type FlowPath,
  type FlowStep,
} from "@/lib/flows";
import { roomLeft } from "@/lib/limits";
import { nextSendTime } from "@/lib/sms";

import { PAID } from "./analytics-sql";
import { audit } from "./auth";
import { getContactPolicy, recentContacts } from "./contact-policy";
import { sendEmail } from "./email";
import { advanceCursor, readEventsAfter } from "./event-log";
import { limitFor, usageNow } from "./limits";
import { log } from "./log";
import { factsForEmail, marketingEmail } from "./marketing-email";
import { segmentsOfAddress } from "./segment-membership";
import { isPaused } from "./sending-guard";
import { storeById, type EmailStore } from "./shopper-emails";
import { textList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Flows (D767, `docs/flows.md`, email plan M2.1, slice 1): the only writer of `commerce.flows`, `flow_versions`, `flow_runs` and
 * `flow_run_steps`. People enter from the event log (the reader `flows`), and the every-minute marketing job moves each due run on with
 * `advance()`: an email goes through the sending guard (D730), the plan's room, quiet hours and the contact policy (D764) as automation
 * emails do; a wait sets when the run wakes; a goal or the end of the tree ends it.
 */

const READER = "flows";
const RUN_BATCH = 200;
const RUNS_KEEP_DAYS = 90;
/** A run whose step was held by the sending guard looks again in an hour. */
const PAUSED_RETRY_HOURS = 1;

// ---------------------------------------------------------------------------
// Saving, testing, switching
// ---------------------------------------------------------------------------

export type FlowView = { id: string; name: string; trigger: string; enabled: boolean; version: number; tested: boolean; steps: FlowStep[]; goals: FlowGoal[] };

const flowRow = z.object({
  id: col.uuid,
  name: col.text,
  trigger: col.text,
  enabled: col.bool,
  version: col.int,
  tested_version: z.number().int().nullable(),
  steps: z.unknown(),
  goals: z.unknown(),
});

const viewOf = (r: z.infer<typeof flowRow>): FlowView => ({
  id: r.id,
  name: r.name,
  trigger: r.trigger,
  enabled: r.enabled,
  version: r.version,
  tested: r.tested_version === r.version,
  steps: z.array(flowStepSchema).parse(r.steps),
  goals: z.array(z.object({ kind: z.literal("ordered") })).parse(r.goals),
});

const FLOW_SELECT = sql`select f.id, f.name, f.trigger, f.enabled, f.version, f.tested_version, v.steps, v.goals
  from commerce.flows f join commerce.flow_versions v on v.flow_id = f.id and v.version = f.version`;

/** A store's flows, newest first. */
export async function listFlows(storeId: string): Promise<FlowView[]> {
  return (await typedRows(flowRow, sql`${FLOW_SELECT} where f.store_id = ${storeId}::uuid order by f.created_at desc`)).map(viewOf);
}

export async function getFlow(storeId: string, id: string): Promise<FlowView | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(flowRow, sql`${FLOW_SELECT} where f.store_id = ${storeId}::uuid and f.id = ${id}::uuid`);
  return row ? viewOf(row) : null;
}

const savedRow = z.object({ id: col.uuid, version: col.int });

export type SaveFlowResult = { ok: true; id: string; version: number } | { ok: false; problem: string };

/** Saves a flow as a new version, switched off until that version is tested. */
export async function saveFlow(storeId: string, accountId: string | null, id: string | null, input: unknown): Promise<SaveFlowResult> {
  const parsed = flowInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the flow." };
  const problems = checkFlow(parsed.data.steps);
  if (problems.length > 0) return { ok: false, problem: problems[0] };
  const { name, trigger, steps, goals } = parsed.data;
  const saved = await db().transaction(async (tx) => {
    const [raw] = id
      ? await tx.execute(sql`
          update commerce.flows set name = ${name}, trigger = ${trigger}, enabled = false, version = version + 1, updated_at = now()
           where store_id = ${storeId}::uuid and id = ${id}::uuid returning id, version`)
      : await tx.execute(sql`
          insert into commerce.flows (store_id, name, trigger) values (${storeId}::uuid, ${name}, ${trigger}) returning id, version`);
    if (!raw) return null;
    const row = savedRow.parse(raw);
    await tx.execute(sql`
      insert into commerce.flow_versions (store_id, flow_id, version, steps, goals)
      values (${storeId}::uuid, ${String(row.id)}::uuid, ${Number(row.version)}, ${JSON.stringify(steps)}::jsonb, ${JSON.stringify(goals)}::jsonb)`);
    return { id: String(row.id), version: Number(row.version) };
  });
  if (!saved) return { ok: false, problem: "That flow is not this store's." };
  await audit(accountId, storeId, "marketing.flow_saved", { flow: saved.id, version: saved.version });
  return { ok: true, ...saved };
}

export type FlowTest = { ok: true; person: string | null; emails: string[]; ends: "goal" | "done" } | { ok: false; problem: string };

/**
 * Walks the store's newest subscriber through the saved version, as they are now, and sends nothing: the subjects of the emails they would get, in order,
 * taking every wait at once. Marks that version tested, so it may be switched on.
 */
export async function testFlow(storeId: string, id: string): Promise<FlowTest> {
  const flow = await getFlow(storeId, id);
  if (!flow) return { ok: false, problem: "That flow is not this store's." };
  const person = await typedRow(
    z.object({ email: col.text }),
    sql`select email from commerce.marketing_subscribers where store_id = ${storeId}::uuid and status = 'subscribed' order by created_at desc limit 1`,
  );
  const facts: FlowFacts = { orderedSinceEntry: false, clickedFlowEmail: false, segments: new Set() };
  const emails: string[] = [];
  let path: FlowPath | null = ["0"];
  let ends: "goal" | "done" = "done";
  for (let guard = 0; guard < 100; guard++) {
    const move = advance(flow.steps, flow.goals, path, facts);
    if (move.do === "end") {
      ends = move.reason;
      break;
    }
    if (move.do === "email") emails.push(Object.values(move.step.content)[0]?.subject || move.step.id);
    path = move.next;
  }
  await db().execute(sql`update commerce.flows set tested_version = version where store_id = ${storeId}::uuid and id = ${id}::uuid`);
  return { ok: true, person: person?.email ?? null, emails, ends };
}

/** Switches a flow on (only once its saved version is tested) or off; off stops nobody already in it. */
export async function switchFlow(storeId: string, accountId: string | null, id: string, on: boolean): Promise<"ok" | "untested" | "missing"> {
  const rows = await db().execute(sql`
    update commerce.flows set enabled = ${on}, updated_at = now()
     where store_id = ${storeId}::uuid and id = ${id}::uuid and (${!on} or tested_version = version) returning id`);
  if (rows.length === 0) return (await getFlow(storeId, id)) ? "untested" : "missing";
  await audit(accountId, storeId, on ? "marketing.flow_on" : "marketing.flow_off", { flow: id });
  return "ok";
}

// ---------------------------------------------------------------------------
// Entering from the event log
// ---------------------------------------------------------------------------

/**
 * Reads the event log's new trigger events (reader `flows`) and makes a run for the subscribed person each names, in every switched-on flow
 * of that store and trigger: once per event, and never a second while one is running. The person is the subscriber the event names, or the
 * subscribed address of the order or cart. Returns how many runs began.
 */
export async function enterFlows(): Promise<number> {
  const batch = await readEventsAfter(READER, { events: FLOW_TRIGGERS, limit: 500 });
  if (!batch.claim) return 0;
  let entered = 0;
  for (const event of batch.events) {
    if (!event.storeId || !event.subjectId) continue;
    const person =
      event.event === "subscriber.subscribed"
        ? sql`select s.id from commerce.marketing_subscribers s where s.store_id = ${event.storeId}::uuid and s.id = ${event.subjectId}::uuid`
        : event.event === "order.paid"
          ? sql`select s.id from commerce.orders o join commerce.marketing_subscribers s on s.store_id = o.store_id and lower(s.email) = lower(o.email)
                 where o.store_id = ${event.storeId}::uuid and o.id = ${event.subjectId}::uuid`
          : sql`select s.id from commerce.abandoned_checkouts a join commerce.marketing_subscribers s on s.store_id = a.store_id and lower(s.email) = lower(a.email)
                 where a.store_id = ${event.storeId}::uuid and a.id = ${event.subjectId}::uuid`;
    const rows = await db().execute(sql`
      insert into commerce.flow_runs (store_id, flow_id, version, subscriber_id, entry_key, path)
      select f.store_id, f.id, f.version, p.id, ${String(event.id)}, '0'
        from commerce.flows f, (${person}) p
        join commerce.marketing_subscribers s on s.id = p.id and s.status = 'subscribed'
       where f.store_id = ${event.storeId}::uuid and f.enabled and f.trigger = ${event.event}
      on conflict do nothing
      returning id`);
    entered += rows.length;
  }
  await advanceCursor(READER, batch.lastId, batch.claim);
  return entered;
}

// ---------------------------------------------------------------------------
// Moving on
// ---------------------------------------------------------------------------

const dueRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  flow_id: col.uuid,
  path: col.textOrNull,
  entered_at: col.timestamp,
  steps: z.unknown(),
  goals: z.unknown(),
  email: col.text,
  locale: col.text,
  market_code: col.textOrNull,
  token: col.text,
  status: col.text,
});

export type FlowRunResult = { sent: number; suppressed: number; waiting: number; ended: number };

/** Moves each due run on, once (a run never takes two steps that send in one turn). Never throws. */
export async function runFlows(options: { now?: Date; only?: string } = {}): Promise<FlowRunResult> {
  const now = options.now ?? new Date();
  const result: FlowRunResult = { sent: 0, suppressed: 0, waiting: 0, ended: 0 };
  let due: z.infer<typeof dueRow>[];
  try {
    due = await typedRows(
      dueRow,
      sql`
        with claimed as (
          update commerce.flow_runs r set claimed_until = ${now.toISOString()}::timestamptz + interval '5 minutes'
           where r.id in (
             select id from commerce.flow_runs
              where status = 'running' and wake_at <= ${now.toISOString()}::timestamptz
                and (claimed_until is null or claimed_until < ${now.toISOString()}::timestamptz)
                ${options.only ? sql`and store_id = ${options.only}::uuid` : sql``}
              order by wake_at limit ${RUN_BATCH} for update skip locked)
          returning r.id, r.store_id, r.flow_id, r.version, r.path, r.entered_at, r.subscriber_id
        )
        select c.id, c.store_id, c.flow_id, c.path, c.entered_at, v.steps, v.goals, s.email, s.locale, s.market_code, s.token, s.status
          from claimed c
          join commerce.flow_versions v on v.flow_id = c.flow_id and v.version = c.version
          join commerce.marketing_subscribers s on s.store_id = c.store_id and s.id = c.subscriber_id`,
    );
  } catch (error) {
    log("error", "flows.claim_failed", {}, error);
    return result;
  }
  const stores = new Map<string, EmailStore | null>();
  const rooms = new Map<string, number>();
  for (const run of due) {
    try {
      await moveOn(run, now, stores, rooms, result);
    } catch (error) {
      log("error", "flows.move_failed", { run: run.id }, error);
    }
  }
  return result;
}

async function settle(run: { id: string; store_id: string }, set: { path: FlowPath | null; wakeAt?: Date; end?: "goal" | "done" | "stopped" }) {
  if (set.end) {
    await db().execute(sql`
      update commerce.flow_runs set status = ${set.end}, ended_at = now(), path = null, claimed_until = null
       where store_id = ${run.store_id}::uuid and id = ${run.id}::uuid`);
    return;
  }
  await db().execute(sql`
    update commerce.flow_runs set path = ${set.path ? pathText(set.path) : null}, wake_at = ${(set.wakeAt ?? new Date()).toISOString()}::timestamptz, claimed_until = null
     where store_id = ${run.store_id}::uuid and id = ${run.id}::uuid`);
}

async function factsFor(run: z.infer<typeof dueRow>, steps: FlowStep[], store: EmailStore | null): Promise<FlowFacts> {
  const ordered = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.orders o
         where o.store_id = ${run.store_id}::uuid and lower(o.email) = lower(${run.email}) and o.placed_at > ${run.entered_at}::timestamptz
           and o.restricted_at is null and ${PAID}`,
  );
  const named = JSON.stringify(steps).match(/"segmentId":"([0-9a-f-]{36})"/g)?.map((m) => m.slice(13, -1)) ?? [];
  const segments = named.length > 0 && store ? await segmentsOfAddress(store, run.email, named) : new Set<string>();
  // Clicks in a flow's emails are not tracked per person yet (slice 2): the condition holds for nobody until then.
  return { orderedSinceEntry: (ordered?.n ?? 0) > 0, clickedFlowEmail: false, segments };
}

async function moveOn(
  run: z.infer<typeof dueRow>,
  now: Date,
  stores: Map<string, EmailStore | null>,
  rooms: Map<string, number>,
  result: FlowRunResult,
): Promise<void> {
  if (run.status !== "subscribed") {
    await settle(run, { path: null, end: "stopped" });
    result.ended++;
    return;
  }
  const steps = z.array(flowStepSchema).parse(run.steps);
  const goals = z.array(z.object({ kind: z.literal("ordered") })).parse(run.goals);
  if (!stores.has(run.store_id)) stores.set(run.store_id, await storeById(run.store_id));
  const store = stores.get(run.store_id) ?? null;
  const path = run.path === null ? null : pathOf(run.path);
  const move = advance(steps, goals, path, await factsFor(run, steps, store));
  if (move.do === "end") {
    await settle(run, { path: null, end: move.reason });
    result.ended++;
    return;
  }
  if (move.do === "wait") {
    await settle(run, { path: move.next, wakeAt: new Date(now.getTime() + move.hours * 3_600_000) });
    result.waiting++;
    return;
  }
  // An email: held while the store's marketing is paused, waiting for the reader's daytime, then the plan's room and the contact policy.
  if (!store) {
    await settle(run, { path: null, end: "stopped" });
    result.ended++;
    return;
  }
  if (await isPaused(run.store_id)) {
    await settle(run, { path, wakeAt: new Date(now.getTime() + PAUSED_RETRY_HOURS * 3_600_000) });
    result.waiting++;
    return;
  }
  const policy = await getContactPolicy(run.store_id);
  const day = nextSendTime(now, run.market_code ?? store.markets[0]?.code ?? "NO");
  if (policy.quietHours && day.getTime() > now.getTime()) {
    await settle(run, { path, wakeAt: day });
    result.waiting++;
    return;
  }
  const held = await heldBy(run, store, now, policy, rooms);
  const key = `flow:${run.id}:${move.step.id}`;
  let outcome: "sent" | "logged" | "failed" | "suppressed" = "suppressed";
  if (!held) {
    const facts = await factsForEmail(store, move.step.content, run.locale, run.market_code);
    const email = marketingEmail({ store, content: move.step.content, locale: run.locale, marketCode: run.market_code, token: run.token, facts });
    const sent = email
      ? await sendEmail({
          storeId: run.store_id,
          kind: "marketing.automation",
          to: run.email,
          email,
          fromName: store.name,
          replyTo: store.details.contactEmail ?? null,
          idempotencyKey: key,
          headers: email.headers,
        })
      : "failed";
    outcome = sent === "duplicate" ? "sent" : sent === "suppressed" ? "suppressed" : sent;
    rooms.set(run.store_id, (rooms.get(run.store_id) ?? 1) - 1);
  }
  await db().execute(sql`
    insert into commerce.flow_run_steps (store_id, run_id, step_id, outcome, suppressed_reason)
    values (${run.store_id}::uuid, ${run.id}::uuid, ${move.step.id}, ${outcome}, ${held})
    on conflict do nothing`);
  if (outcome === "sent" || outcome === "logged") result.sent++;
  else result.suppressed++;
  // Held or sent, the run goes on to the step after: a held email is not sent later.
  if (move.next) await settle(run, { path: move.next, wakeAt: now });
  else {
    await settle(run, { path: null, end: "done" });
    result.ended++;
  }
}

/** Why an email of a flow is held, or null: the plan's room this month, then the contact policy. */
async function heldBy(
  run: z.infer<typeof dueRow>,
  store: EmailStore,
  now: Date,
  policy: Awaited<ReturnType<typeof getContactPolicy>>,
  rooms: Map<string, number>,
): Promise<PolicyReason | "room" | null> {
  if (!rooms.has(run.store_id)) {
    const allowed = await limitFor(run.store_id, "marketing_emails_month");
    rooms.set(run.store_id, allowed === null ? Infinity : roomLeft(await usageNow(run.store_id, "marketing_emails_month", now), allowed));
  }
  if ((rooms.get(run.store_id) ?? 0) < 1) return "room";
  const [recent] = await recentContacts(store.id, [{ email: run.email, customerId: null }], now);
  return policyVerdict(recent, now, policy, "normal");
}

/** Runs that ended more than 90 days ago, as a statement for a `with` in the daily recipients prune (the daily route's budget holds). */
export const flowRunsPrune = () =>
  sql`delete from commerce.flow_runs where status <> 'running' and ended_at < now() - make_interval(days => ${RUNS_KEEP_DAYS})`;

/**
 * The every-minute job's turn: while no flow is switched on anywhere (one read), nothing more; else people enter from the event log and the
 * due runs move on, whose runs may still be going after their flow was switched off. Never throws.
 */
export async function tickFlows(): Promise<void> {
  try {
    const any = await typedRow(
      z.object({ on: col.bool }),
      sql`select exists (select 1 from commerce.flows where enabled) or exists (select 1 from commerce.flow_runs where status = 'running') as on`,
    );
    if (!any?.on) return;
    await enterFlows();
    await runFlows();
  } catch (error) {
    log("error", "flows.tick_failed", {}, error);
  }
}

const personRunRow = z.object({ flow: col.text, entered_at: col.timestamp, status: col.text, ended_at: col.timestampOrNull });

/** A person's runs for their export: the flow's name, when they entered, how it stands; by the subscriber rows their addresses or account own. */
export async function flowRunsOf(storeId: string, addresses: string[], customerId: string | null): Promise<{ flow: string; enteredAt: string; status: string; endedAt: string | null }[]> {
  const rows = await typedRows(
    personRunRow,
    sql`select f.name as flow, r.entered_at, r.status, r.ended_at from commerce.flow_runs r
          join commerce.flows f on f.store_id = r.store_id and f.id = r.flow_id
          join commerce.marketing_subscribers m on m.store_id = r.store_id and m.id = r.subscriber_id
         where r.store_id = ${storeId}::uuid and (lower(m.email) = any(${textList(addresses)}) or m.customer_id = ${customerId}::uuid)
         order by r.entered_at`,
  );
  return rows.map((r) => ({ flow: r.flow, enteredAt: r.entered_at, status: r.status, endedAt: r.ended_at }));
}
