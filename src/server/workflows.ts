import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { normaliseTag } from "@/lib/order-tags";
import { siteUrl } from "@/lib/site";
import {
  actionsFor,
  RUNS_PER_HOUR,
  scheduleDue,
  workflowInputSchema,
  workflowMatches,
  workflowProblems,
  WORKFLOWS_MAX,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowInput,
  type WorkflowSchedule,
  type WorkflowTrigger,
} from "@/lib/workflows";

import { audit, type Membership } from "./auth";
import { sendEmail } from "./email";
import { askFromWorkflow } from "./follow-ups";
import { postToSlack, subjectData } from "./integrations";
import { log } from "./log";
import { SYSTEM_ACTOR } from "./order-actor";
import { addOrderNote } from "./order-admin";
import { changeOrderTags } from "./order-tags";
import { memberCan } from "./permissions";
import { addTag } from "./segments";
import { emailFooter, storeById } from "./shopper-emails";
import { alertRecipients } from "./staff-alerts";
import { col, typedRow, typedRows } from "./typed-rows";
import { latestSubject } from "./workflow-subjects";

/**
 * Workflows (wave 9 unit C, D356): the only writer of `commerce.workflows` and, with the database's intake (`queue_integration_event()`), of
 * `commerce.workflow_runs`. A workflow is saved off; a save raises its version, and it is switched on only after *Test* ran the version saved
 * (the database refuses otherwise). The runner (`runWorkflows()`, every minute) claims each pending run, reads what the event is about as
 * unit A's endpoints get it (`subjectData()`), checks the conditions and runs each action through its screen's own function: an order's tag
 * (`changeOrderTags()`), a customer's (`addTag()`), staff's email (the automation recipients), Slack (`postToSlack()`), a signed request to one
 * of the owner's endpoints (a delivery the integrations job signs and sends) and the AI manager (`askFromWorkflow()`). No action makes an
 * event a workflow waits for, so a workflow cannot start itself; and each is capped at `RUNS_PER_HOUR` runs an hour. An email to a customer,
 * a refund or anything that spends is not an action (they are a person's).
 */

export type Workflow = WorkflowInput & {
  id: string;
  enabled: boolean;
  version: number;
  testedVersion: number | null;
  updatedAt: string;
  lastRun: { at: string; status: string; matched: boolean | null } | null;
  runsLastDay: number;
};

const workflowRow = z.object({
  id: col.uuid,
  name: col.text,
  trigger: col.text,
  schedule: z.unknown().nullable(),
  conditions: z.unknown(),
  actions: z.unknown(),
  enabled: col.bool,
  version: col.int,
  tested_version: col.int.nullable(),
  updated_at: col.timestamp,
  last_at: col.timestampOrNull,
  last_status: col.textOrNull,
  last_matched: z.boolean().nullable(),
  runs_day: col.int,
});

function toWorkflow(row: z.output<typeof workflowRow>): Workflow {
  return {
    id: row.id,
    name: row.name,
    trigger: row.trigger as WorkflowTrigger,
    schedule: (row.schedule as WorkflowSchedule | null) ?? null,
    conditions: (row.conditions as WorkflowCondition[]) ?? [],
    actions: (row.actions as WorkflowAction[]) ?? [],
    enabled: row.enabled,
    version: row.version,
    testedVersion: row.tested_version,
    updatedAt: row.updated_at,
    lastRun: row.last_at && row.last_status ? { at: row.last_at, status: row.last_status, matched: row.last_matched } : null,
    runsLastDay: row.runs_day,
  };
}

const READ = sql`
  select w.id, w.name, w.trigger, w.schedule, w.conditions, w.actions, w.enabled, w.version, w.tested_version, w.updated_at,
    last.created_at as last_at, last.status as last_status, last.matched as last_matched,
    (select count(*)::int from commerce.workflow_runs r where r.workflow_id = w.id and r.created_at > now() - interval '1 day') as runs_day
  from commerce.workflows w
  left join lateral (select r.created_at, r.status, r.matched from commerce.workflow_runs r where r.workflow_id = w.id order by r.created_at desc limit 1) last on true
`;

export async function listWorkflows(storeId: string): Promise<Workflow[]> {
  return (await typedRows(workflowRow, sql`${READ} where w.store_id = ${storeId}::uuid order by w.created_at, w.id`)).map(toWorkflow);
}

export async function getWorkflow(storeId: string, id: string): Promise<Workflow | null> {
  const row = await typedRow(workflowRow, sql`${READ} where w.store_id = ${storeId}::uuid and w.id = ${id}::uuid`);
  return row ? toWorkflow(row) : null;
}

export type SaveWorkflowOutcome = { ok: true; id: string } | { ok: false; problems: string[] };

/** Checks a workflow as typed: its shape, its fields and actions for its trigger, an endpoint of the store's own, an ask only by an owner. */
async function checked(member: Membership, raw: unknown): Promise<{ ok: true; input: WorkflowInput } | { ok: false; problems: string[] }> {
  const parsed = workflowInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const input = parsed.data as WorkflowInput;
  const problems = workflowProblems(input);
  for (const action of input.actions) {
    if ((action.kind === "tag_order" || action.kind === "tag_customer") && !normaliseTag(action.tag).ok) problems.push("A tag is at most 40 characters, without a comma.");
    if (action.kind === "ask_ai_manager" && !memberCan(member, "owner")) problems.push("Only an owner can make a workflow that asks the AI manager: it runs in their name.");
    if (action.kind === "send_request") {
      const [endpoint] = await db().execute(sql`
        select 1 from commerce.webhook_endpoints where store_id = ${member.store.id}::uuid and id = ${action.endpointId}::uuid
      `);
      if (!endpoint) problems.push("Choose one of your own endpoints (Integrations → Your own endpoints).");
    }
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true, input };
}

/** Makes or changes a workflow; it is saved off, as a new version that must be tested again before it is switched on. */
export async function saveWorkflow(member: Membership, id: string | null, raw: unknown): Promise<SaveWorkflowOutcome> {
  const result = await checked(member, raw);
  if (!result.ok) return result;
  const { input } = result;
  const values = {
    schedule: input.schedule ? JSON.stringify(input.schedule) : null,
    conditions: JSON.stringify(input.conditions),
    actions: JSON.stringify(input.actions),
  };
  const saved = await db().transaction(async (tx) => {
    if (id) {
      const rows = await tx.execute<{ id: string }>(sql`
        update commerce.workflows set name = ${input.name}, trigger = ${input.trigger}, schedule = ${values.schedule}::jsonb,
          conditions = ${values.conditions}::jsonb, actions = ${values.actions}::jsonb, enabled = false, version = version + 1,
          updated_by = ${member.account.id}::uuid, updated_at = now()
        where store_id = ${member.store.id}::uuid and id = ${id}::uuid
        returning id
      `);
      return rows[0] ? String(rows[0].id) : "gone";
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('workflows'), hashtext(${member.store.id}))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.workflows where store_id = ${member.store.id}::uuid`);
    if (Number(count?.n ?? 0) >= WORKFLOWS_MAX) return "limit";
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.workflows (store_id, name, trigger, schedule, conditions, actions, created_by, updated_by)
      values (${member.store.id}::uuid, ${input.name}, ${input.trigger}, ${values.schedule}::jsonb, ${values.conditions}::jsonb,
        ${values.actions}::jsonb, ${member.account.id}::uuid, ${member.account.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (saved === "gone") return { ok: false, problems: ["That workflow is no longer there."] };
  if (saved === "limit") return { ok: false, problems: [`A store can have at most ${WORKFLOWS_MAX} workflows.`] };
  await audit(member.account.id, member.store.id, id ? "automation.workflow_changed" : "automation.workflow_made", { trigger: input.trigger, actions: input.actions.length }, { target: { type: "workflow", id: saved } });
  return { ok: true, id: saved };
}

/** Switches a workflow on (only once the version saved was tested) or off. */
export async function switchWorkflow(member: Membership, id: string, on: boolean): Promise<"ok" | "untested" | "gone"> {
  const rows = await db().execute<{ id: string }>(sql`
    update commerce.workflows set enabled = ${on}, updated_at = now()
    where store_id = ${member.store.id}::uuid and id = ${id}::uuid and (${!on} or tested_version = version)
    returning id
  `);
  if (rows.length === 0) return (await getWorkflow(member.store.id, id)) ? "untested" : "gone";
  await audit(member.account.id, member.store.id, on ? "automation.workflow_on" : "automation.workflow_off", {}, { target: { type: "workflow", id } });
  return "ok";
}

export async function deleteWorkflow(member: Membership, id: string): Promise<boolean> {
  const rows = await db().execute(sql`delete from commerce.workflows where store_id = ${member.store.id}::uuid and id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(member.account.id, member.store.id, "automation.workflow_deleted", {}, { target: { type: "workflow", id } });
  return true;
}

// ---------------------------------------------------------------------------
// Testing: the latest matching event, nothing done
// ---------------------------------------------------------------------------

export type TestOutcome =
  | { ok: true; found: boolean; matched: boolean; about: string | null; actions: { kind: WorkflowAction["kind"]; would: string }[] }
  | { ok: false; problem: "gone" };

/** What a workflow would do on the latest matching event, doing nothing; marks the version tested. */
export async function testWorkflow(member: Membership, id: string): Promise<TestOutcome> {
  const flow = await getWorkflow(member.store.id, id);
  if (!flow) return { ok: false, problem: "gone" };
  const store = { id: member.store.id, slug: member.store.slug, name: member.store.name };
  let data: Record<string, unknown> | null = null;
  let found = flow.trigger === "schedule" || flow.trigger === "support.waiting";
  if (flow.trigger === "support.waiting") data = await subjectData(store, flow.trigger, null);
  else if (flow.trigger !== "schedule") {
    const subject = await latestSubject(member.store.id, flow.trigger);
    data = subject ? await subjectData(store, flow.trigger, subject) : null;
    found = data !== null;
  }
  const matched = found && workflowMatches(flow.conditions, data ?? {});
  await db().execute(sql`update commerce.workflows set tested_version = version where store_id = ${member.store.id}::uuid and id = ${id}::uuid`);
  await audit(member.account.id, member.store.id, "automation.workflow_tested", { found, matched }, { target: { type: "workflow", id } });
  return { ok: true, found, matched, about: aboutOf(data), actions: matched ? flow.actions.map((action) => ({ kind: action.kind, would: wouldDo(action, data) })) : [] };
}

/** The event's subject in a few words: an order's number, a product's handle, a SKU. */
function aboutOf(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const pick = (key: string, field: string) => {
    const value = (data[key] as Record<string, unknown> | undefined)?.[field];
    return value === undefined || value === null ? null : String(value);
  };
  return pick("order", "number") ?? pick("product", "handle") ?? pick("stock", "sku") ?? pick("discount", "code") ?? pick("return", "number") ?? pick("customer", "id") ?? null;
}

/** What an action would do, in plain words for the test (English: the screen words it again from the kind). */
function wouldDo(action: WorkflowAction, data: Record<string, unknown> | null): string {
  switch (action.kind) {
    case "tag_order":
    case "tag_customer":
      return action.tag;
    case "note_order":
      return action.text.slice(0, 120);
    case "email_staff":
      return action.subject;
    case "post_slack":
      return action.text.slice(0, 120);
    case "send_request":
      return data ? "signed request" : "nothing to send";
    case "ask_ai_manager":
      return action.question.slice(0, 120);
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

type ActionOutcome = { kind: WorkflowAction["kind"]; ok: boolean; problem?: string };

/** The store's owners as email recipients: a workflow's staff email when nobody is chosen for automation. */
async function ownersOf(storeId: string): Promise<{ to: string; recipient: string }[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`
      select distinct on (a.id) a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
      where m.store_id = ${storeId}::uuid and m.disabled_at is null and m.role = 'owner' and a.email <> ''
    `,
  );
  return rows.map((row) => ({ to: row.email, recipient: row.id }));
}

/** The email of an order or a customer the event is about, for a customer's tag. */
function emailOf(data: Record<string, unknown>): string | null {
  for (const key of ["order", "customer", "subscription"]) {
    const email = (data[key] as Record<string, unknown> | undefined)?.email;
    if (typeof email === "string" && email.includes("@")) return email;
  }
  return null;
}

async function act(run: { id: string; storeId: string; workflowId: string; event: string; subjectId: string | null; name: string; account: string | null }, action: WorkflowAction, index: number, data: Record<string, unknown>): Promise<ActionOutcome> {
  const fail = (problem: string): ActionOutcome => ({ kind: action.kind, ok: false, problem });
  switch (action.kind) {
    case "tag_order": {
      const tag = normaliseTag(action.tag);
      if (!tag.ok || !run.subjectId) return fail("invalid");
      const result = await changeOrderTags(run.storeId, run.subjectId, { add: [tag.tag] }, SYSTEM_ACTOR, { audit: false });
      if (!result.ok) return fail("not_found");
      return result.change.refused.length > 0 ? fail("limit") : { kind: action.kind, ok: true };
    }
    case "note_order": {
      // A staff note on the order's history, as the order page's *Add a note* writes it, named after the workflow.
      if (!run.subjectId) return fail("invalid");
      await addOrderNote(run.storeId, run.subjectId, action.text, `Workflow: ${run.name}`);
      return { kind: action.kind, ok: true };
    }
    case "tag_customer": {
      const email = emailOf(data);
      if (!email) return fail("no_email");
      if (!run.account) return fail("no_owner");
      const added = await addTag(run.storeId, run.account, email, action.tag);
      return added.ok ? { kind: action.kind, ok: true } : fail("invalid");
    }
    case "email_staff": {
      const [chosen, store] = await Promise.all([alertRecipients(run.storeId, "automation"), storeById(run.storeId)]);
      if (!store) return fail("failed");
      // Those chosen for automation under Notifications; with none chosen, the store's owners, so *Email staff* reaches someone.
      const targets =
        chosen.length > 0
          ? chosen.map((t) => ({ to: t.to, recipient: t.recipient.kind === "contact" ? "contact" : t.recipient.accountId }))
          : await ownersOf(run.storeId);
      if (targets.length === 0) return fail("no_recipients");
      const email = renderEmail({
        subject: `${action.subject} (${run.name})`.slice(0, 200),
        preview: action.text.slice(0, 120),
        lang: "en",
        footer: emailFooter(store, emailText("en")),
        blocks: [
          { type: "heading", text: action.subject },
          { type: "paragraph", text: action.text },
          { type: "paragraph", text: `Sent by the workflow "${run.name}" of the store.` },
          { type: "button", text: "Open the workflows", url: `${siteUrl()}/admin/${store.slug}/settings/workflows` },
        ],
      });
      const outcomes = [];
      for (const t of targets) {
        outcomes.push(await sendEmail({ storeId: run.storeId, kind: "automation.notify", to: t.to, email, fromName: store.name, idempotencyKey: `workflow:${run.id}:${index}:${t.recipient}` }));
      }
      return outcomes.some((o) => o === "sent" || o === "logged" || o === "duplicate") ? { kind: action.kind, ok: true } : fail("failed");
    }
    case "post_slack": {
      const posted = await postToSlack(run.storeId, action.text);
      if (!posted.ok) return fail(posted.error ? "not_connected" : "failed");
      return { kind: action.kind, ok: true };
    }
    case "send_request": {
      // A delivery of the event to one of the owner's own endpoints, signed and retried by the integrations job as any other (D354).
      const rows = await db().execute(sql`
        insert into commerce.integration_deliveries (store_id, provider, event, subject_id, endpoint_id)
        select e.store_id, 'webhook', ${run.event}, ${run.subjectId}::uuid, e.id
        from commerce.webhook_endpoints e where e.store_id = ${run.storeId}::uuid and e.id = ${action.endpointId}::uuid and e.enabled
        returning id
      `);
      if (rows.length === 0) return fail("endpoint_off");
      return { kind: action.kind, ok: true };
    }
    case "ask_ai_manager": {
      if (!run.subjectId) return fail("invalid");
      const order = data.order as Record<string, unknown> | undefined;
      const asked = await db().transaction((tx) =>
        askFromWorkflow(tx, { storeId: run.storeId, workflowId: run.workflowId, name: run.name, question: action.question, orderId: run.subjectId!, orderNumber: String(order?.number ?? "") }),
      );
      return asked === "ok" ? { kind: action.kind, ok: true } : fail(asked);
    }
  }
}

/** The store's wall clock now: its date, time and ISO weekday. */
function localNow(timeZone: string, now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

/** Queues today's run of every scheduled workflow that is on and due, once a day (its key is the day). */
export async function queueScheduledRuns(now = new Date()): Promise<number> {
  const due = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, schedule: z.unknown(), time_zone: col.text }),
    sql`
      select w.id, w.store_id, w.schedule, s.time_zone from commerce.workflows w join commerce.stores s on s.id = w.store_id
      where w.enabled and w.trigger = 'schedule' and commerce.store_is_active(s.id)
    `,
  );
  let queued = 0;
  for (const flow of due) {
    const key = scheduleDue(flow.schedule as WorkflowSchedule, localNow(flow.time_zone || "Europe/Oslo", now));
    if (!key) continue;
    const rows = await db().execute(sql`
      insert into commerce.workflow_runs (store_id, workflow_id, event, event_key)
      values (${flow.store_id}::uuid, ${flow.id}::uuid, 'schedule', ${key})
      on conflict on constraint workflow_runs_once_key do nothing
      returning id
    `);
    queued += rows.length;
  }
  return queued;
}

/**
 * Runs what is due: today's schedules queued, then each pending run claimed for five minutes (two runs never take one), its event read as
 * it is now, its conditions checked and its actions run in order. A store that is not open runs nothing. Never throws for one run.
 */
export async function runWorkflows(limit = 50, now = new Date()): Promise<{ runs: number; matched: number }> {
  await queueScheduledRuns(now);
  const claimed = await typedRows(
    z.object({
      id: col.uuid,
      store_id: col.uuid,
      workflow_id: col.uuid,
      event: col.text,
      subject_id: col.uuid.nullable(),
      name: col.text,
      conditions: z.unknown(),
      actions: z.unknown(),
      account: col.uuid.nullable(),
      slug: col.text,
      store_name: col.text,
      open: col.bool,
    }),
    sql`
      with due as (
        select r.id from commerce.workflow_runs r
        where r.status = 'pending' and (r.claimed_until is null or r.claimed_until < now())
        order by r.created_at limit ${limit}
        for update skip locked
      ), claimed as (
        update commerce.workflow_runs r set claimed_until = now() + interval '5 minutes' from due where r.id = due.id
        returning r.id, r.store_id, r.workflow_id, r.event, r.subject_id
      )
      select c.*, w.name, w.conditions, w.actions, coalesce(w.updated_by, w.created_by) as account, s.slug, s.name as store_name,
        commerce.store_is_active(s.id) as open
      from claimed c join commerce.workflows w on w.id = c.workflow_id join commerce.stores s on s.id = c.store_id
    `,
  );
  let matchedCount = 0;
  for (const run of claimed) {
    try {
      const actions = (run.actions as WorkflowAction[]) ?? [];
      const conditions = (run.conditions as WorkflowCondition[]) ?? [];
      let data: Record<string, unknown> | null = run.event === "schedule" ? {} : await subjectData({ id: run.store_id, slug: run.slug, name: run.store_name }, run.event, run.subject_id);
      if (!run.open) data = null;
      const matched = data !== null && workflowMatches(conditions, data);
      const outcomes: ActionOutcome[] = [];
      if (matched) {
        matchedCount++;
        const allowed = new Set(actionsFor(run.event === "schedule" ? "schedule" : (run.event as WorkflowTrigger)));
        for (const [index, action] of actions.entries()) {
          if (!allowed.has(action.kind)) {
            outcomes.push({ kind: action.kind, ok: false, problem: "invalid" });
            continue;
          }
          outcomes.push(
            await act({ id: run.id, storeId: run.store_id, workflowId: run.workflow_id, event: run.event, subjectId: run.subject_id, name: run.name, account: run.account }, action, index, data!).catch(
              (error: unknown) => {
                log("error", "workflows.action_failed", { storeId: run.store_id, workflowId: run.workflow_id, action: action.kind }, error);
                return { kind: action.kind, ok: false, problem: "failed" };
              },
            ),
          );
        }
      }
      await db().execute(sql`
        update commerce.workflow_runs set status = ${outcomes.some((o) => !o.ok) ? "failed" : "done"}, matched = ${matched},
          outcome = ${JSON.stringify({ found: data !== null, actions: outcomes })}::jsonb, finished_at = now(), claimed_until = null
        where id = ${run.id}::uuid
      `);
    } catch (error) {
      log("error", "workflows.run_failed", { storeId: run.store_id, workflowId: run.workflow_id }, error);
    }
  }
  await db().execute(sql`delete from commerce.workflow_runs where created_at < now() - interval '90 days'`);
  return { runs: claimed.length, matched: matchedCount };
}

export type WorkflowRun = { id: string; at: string; event: string; status: string; matched: boolean | null; actions: ActionOutcome[] };

/** A workflow's latest runs, newest first. */
export async function workflowRuns(storeId: string, workflowId: string, limit = 20): Promise<WorkflowRun[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, created_at: col.timestamp, event: col.text, status: col.text, matched: z.boolean().nullable(), outcome: z.unknown().nullable() }),
    sql`
      select id, created_at, event, status, matched, outcome from commerce.workflow_runs
      where store_id = ${storeId}::uuid and workflow_id = ${workflowId}::uuid order by created_at desc limit ${limit}
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    at: row.created_at,
    event: row.event,
    status: row.status,
    matched: row.matched,
    actions: ((row.outcome as { actions?: ActionOutcome[] } | null)?.actions ?? []) as ActionOutcome[],
  }));
}

export { RUNS_PER_HOUR };
