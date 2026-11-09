import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { PLATFORM_WORKFLOWS, platformWorkflowInputSchema, type PlatformWorkflowTrigger } from "@/lib/platform-workflows";
import { siteUrl } from "@/lib/site";
import {
  RUNS_PER_HOUR,
  scheduleDue,
  workflowMatches,
  workflowProblems,
  WORKFLOWS_MAX,
  type AnyWorkflowInput,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowSchedule,
} from "@/lib/workflows";

import { audit, type Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { platformPayload, postPlatformSlack } from "./platform-integrations";
import { col, typedRow, typedRows } from "./typed-rows";
import { localNow } from "./workflows";

/**
 * Workflows on Kaizena Flow's own events (C4 step 3, D516): a store's workflows (D356, `workflows.ts`) for the platform. The only writer of
 * `commerce.platform_workflows` and, with the database's intake (`queue_platform_event()`), of `commerce.platform_workflow_runs`. Saved
 * off; switched on only after *Test* ran the version saved (the database refuses otherwise). The runner (`runPlatformWorkflows()`, every
 * minute beside the stores') claims each pending run, reads the event as the platform's endpoints get it (`platformPayload()`), checks the
 * conditions and runs each action: an email to the platform's owners, a message in its Slack (`postPlatformSlack()`), a signed request to
 * one of its own endpoints (a delivery `deliverPlatformDue()` signs and sends). No action makes a platform event, so a workflow cannot start
 * itself; each is capped at `RUNS_PER_HOUR` runs an hour. A platform owner makes them (the settings area, D510).
 */

const PLATFORM_ZONE = "Europe/Oslo";

export type PlatformWorkflow = AnyWorkflowInput & {
  id: string;
  enabled: boolean;
  version: number;
  testedVersion: number | null;
  lastRun: { at: string; status: string; matched: boolean | null } | null;
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
  last_at: col.timestampOrNull,
  last_status: col.textOrNull,
  last_matched: z.boolean().nullable(),
});

const toWorkflow = (row: z.output<typeof workflowRow>): PlatformWorkflow => ({
  id: row.id,
  name: row.name,
  trigger: row.trigger,
  schedule: (row.schedule as WorkflowSchedule | null) ?? null,
  conditions: (row.conditions as WorkflowCondition[]) ?? [],
  actions: (row.actions as WorkflowAction[]) ?? [],
  enabled: row.enabled,
  version: row.version,
  testedVersion: row.tested_version,
  lastRun: row.last_at && row.last_status ? { at: row.last_at, status: row.last_status, matched: row.last_matched } : null,
});

const READ = sql`
  select w.id, w.name, w.trigger, w.schedule, w.conditions, w.actions, w.enabled, w.version, w.tested_version,
    last.created_at as last_at, last.status as last_status, last.matched as last_matched
  from commerce.platform_workflows w
  left join lateral (select r.created_at, r.status, r.matched from commerce.platform_workflow_runs r where r.workflow_id = w.id order by r.created_at desc limit 1) last on true
`;

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function listPlatformWorkflows(): Promise<PlatformWorkflow[]> {
  return (await typedRows(workflowRow, sql`${READ} order by w.created_at, w.id`)).map(toWorkflow);
}

export async function getPlatformWorkflow(id: string): Promise<PlatformWorkflow | null> {
  if (!isUuid(id)) return null;
  const row = await typedRow(workflowRow, sql`${READ} where w.id = ${id}::uuid`);
  return row ? toWorkflow(row) : null;
}

export type SavePlatformWorkflowOutcome = { ok: true; id: string } | { ok: false; problems: string[] };

/** Checks a workflow as typed: its shape, its fields and actions for its trigger, and an endpoint of the platform's own. */
async function checked(raw: unknown): Promise<{ ok: true; input: AnyWorkflowInput } | { ok: false; problems: string[] }> {
  const parsed = platformWorkflowInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const input = parsed.data as AnyWorkflowInput;
  const problems = workflowProblems(input, PLATFORM_WORKFLOWS);
  for (const action of input.actions) {
    if (action.kind !== "send_request") continue;
    const [endpoint] = await db().execute(sql`select 1 from commerce.platform_webhook_endpoints where id = ${action.endpointId}::uuid`);
    if (!endpoint) problems.push("Choose one of Kaizena Flow's own endpoints (Integrations → Your own endpoints).");
  }
  return problems.length > 0 ? { ok: false, problems: [...new Set(problems)] } : { ok: true, input };
}

/** Makes or changes a workflow; it is saved off, as a new version that must be tested again before it is switched on. */
export async function savePlatformWorkflow(admin: Account, id: string | null, raw: unknown): Promise<SavePlatformWorkflowOutcome> {
  if (id !== null && !isUuid(id)) return { ok: false, problems: ["That workflow is no longer there."] };
  const result = await checked(raw);
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
        update commerce.platform_workflows set name = ${input.name}, trigger = ${input.trigger}, schedule = ${values.schedule}::jsonb,
          conditions = ${values.conditions}::jsonb, actions = ${values.actions}::jsonb, enabled = false, version = version + 1,
          updated_by = ${admin.id}::uuid, updated_at = now()
        where id = ${id}::uuid
        returning id
      `);
      return rows[0] ? String(rows[0].id) : "gone";
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_workflows'))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.platform_workflows`);
    if (Number(count?.n ?? 0) >= WORKFLOWS_MAX) return "limit";
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.platform_workflows (name, trigger, schedule, conditions, actions, created_by, updated_by)
      values (${input.name}, ${input.trigger}, ${values.schedule}::jsonb, ${values.conditions}::jsonb, ${values.actions}::jsonb, ${admin.id}::uuid, ${admin.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (saved === "gone") return { ok: false, problems: ["That workflow is no longer there."] };
  if (saved === "limit") return { ok: false, problems: [`The platform can have at most ${WORKFLOWS_MAX} workflows.`] };
  await audit(admin.id, null, id ? "platform.workflow_changed" : "platform.workflow_made", { trigger: input.trigger, actions: input.actions.length }, { target: { type: "platform_workflow", id: saved } });
  return { ok: true, id: saved };
}

/** Switches a workflow on (only once the version saved was tested) or off. */
export async function switchPlatformWorkflow(admin: Account, id: string, on: boolean): Promise<"ok" | "untested" | "gone"> {
  if (!isUuid(id)) return "gone";
  const rows = await db().execute(sql`
    update commerce.platform_workflows set enabled = ${on}, updated_at = now()
    where id = ${id}::uuid and (${!on} or tested_version = version)
    returning id
  `);
  if (rows.length === 0) return (await getPlatformWorkflow(id)) ? "untested" : "gone";
  await audit(admin.id, null, on ? "platform.workflow_on" : "platform.workflow_off", {}, { target: { type: "platform_workflow", id } });
  return "ok";
}

export async function deletePlatformWorkflow(admin: Account, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db().execute(sql`delete from commerce.platform_workflows where id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(admin.id, null, "platform.workflow_deleted", {}, { target: { type: "platform_workflow", id } });
  return true;
}

// ---------------------------------------------------------------------------
// Testing: the latest event of its kind, nothing done
// ---------------------------------------------------------------------------

/** What the latest event of a trigger was about: the newest request, store (of an owner), store on a plan, or notice. */
async function latestPlatformSubject(trigger: PlatformWorkflowTrigger): Promise<string | null> {
  const query =
    trigger === "request.received"
      ? sql`select id from commerce.access_requests order by created_at desc limit 1`
      : trigger === "report.received"
        ? sql`select id from commerce.content_reports order by created_at desc limit 1`
        : trigger.startsWith("plan.")
          ? sql`select b.store_id as id from commerce.store_billing b join commerce.stores s on s.id = b.store_id where not s.house order by b.updated_at desc limit 1`
          : sql`select id from commerce.stores where not (is_template or starter) and not sandbox and not house order by created_at desc limit 1`;
  const row = await typedRow(z.object({ id: col.uuid }), query);
  return row?.id ?? null;
}

export type PlatformTestOutcome =
  | { ok: true; found: boolean; matched: boolean; about: string | null; actions: { kind: WorkflowAction["kind"]; would: string }[] }
  | { ok: false; problem: "gone" };

/** What a workflow would do on the latest event of its kind, doing nothing; marks the version tested. */
export async function testPlatformWorkflow(admin: Account, id: string): Promise<PlatformTestOutcome> {
  const flow = await getPlatformWorkflow(id);
  if (!flow) return { ok: false, problem: "gone" };
  let data: Record<string, unknown> | null = null;
  if (flow.trigger === "schedule") data = {};
  else {
    const subject = await latestPlatformSubject(flow.trigger as PlatformWorkflowTrigger);
    data = subject ? await platformPayload({ id: "test", event: flow.trigger, subjectId: subject, createdAt: new Date().toISOString() }) : null;
  }
  const found = data !== null;
  const matched = found && workflowMatches(flow.conditions, data ?? {});
  await db().execute(sql`update commerce.platform_workflows set tested_version = version where id = ${id}::uuid`);
  await audit(admin.id, null, "platform.workflow_tested", { found, matched }, { target: { type: "platform_workflow", id } });
  return { ok: true, found, matched, about: aboutOf(data), actions: matched ? flow.actions.map((action) => ({ kind: action.kind, would: wouldDo(action) })) : [] };
}

/** The event's subject in a few words: a store's name, the store asked for, a notice's category. */
function aboutOf(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const pick = (key: string, field: string) => {
    const value = (data[key] as Record<string, unknown> | undefined)?.[field];
    return value === undefined || value === null ? null : String(value);
  };
  return pick("store", "name") ?? pick("request", "store_name") ?? pick("report", "category") ?? null;
}

function wouldDo(action: WorkflowAction): string {
  switch (action.kind) {
    case "email_staff":
      return action.subject;
    case "post_slack":
      return action.text.slice(0, 120);
    case "send_request":
      return "signed request";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

type ActionOutcome = { kind: WorkflowAction["kind"]; ok: boolean; problem?: string };

/** The platform's owners as email recipients. */
async function platformOwners(): Promise<{ id: string; email: string }[]> {
  return typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`select id, email from commerce.accounts where platform_admin and disabled_at is null and email <> '' order by created_at`,
  );
}

async function act(run: { id: string; event: string; subjectId: string | null; name: string }, action: WorkflowAction, index: number): Promise<ActionOutcome> {
  const fail = (problem: string): ActionOutcome => ({ kind: action.kind, ok: false, problem });
  switch (action.kind) {
    case "email_staff": {
      const owners = await platformOwners();
      if (owners.length === 0) return fail("no_recipients");
      const email = renderEmail({
        subject: `${action.subject} (${run.name})`.slice(0, 200),
        preview: action.text.slice(0, 120),
        lang: "en",
        footer: ["Kaizena Flow"],
        blocks: [
          { type: "heading", text: action.subject },
          { type: "paragraph", text: action.text },
          { type: "paragraph", text: `Sent by Kaizena Flow's workflow "${run.name}".` },
          { type: "button", text: "Open the workflows", url: `${siteUrl()}/admin/platform/workflows` },
        ],
      });
      const outcomes = [];
      for (const owner of owners) {
        outcomes.push(await sendEmail({ storeId: null, kind: "platform.workflow", to: owner.email, email, fromName: "Kaizena Flow", idempotencyKey: `platform.workflow:${run.id}:${index}:${owner.id}` }));
      }
      return outcomes.some((o) => o === "sent" || o === "logged" || o === "duplicate") ? { kind: action.kind, ok: true } : fail("failed");
    }
    case "post_slack": {
      const posted = await postPlatformSlack(action.text);
      if (!posted.ok) return fail(posted.status === null && posted.error ? "not_connected" : "failed");
      return { kind: action.kind, ok: true };
    }
    case "send_request": {
      // A delivery of the event to one of the platform's own endpoints, signed and retried by `deliverPlatformDue()` as any other (D515).
      const rows = await db().execute(sql`
        insert into commerce.platform_integration_deliveries (provider, event, subject_id, endpoint_id)
        select 'webhook', ${run.event}, ${run.subjectId}::uuid, e.id
        from commerce.platform_webhook_endpoints e where e.id = ${action.endpointId}::uuid and e.enabled
        returning id
      `);
      return rows.length === 0 ? fail("endpoint_off") : { kind: action.kind, ok: true };
    }
    default:
      return fail("invalid");
  }
}

/** Queues today's run of every scheduled platform workflow that is on and due, in Oslo's time, once a day (its key is the day). */
export async function queuePlatformScheduledRuns(now = new Date()): Promise<number> {
  const due = await typedRows(
    z.object({ id: col.uuid, schedule: z.unknown() }),
    sql`select id, schedule from commerce.platform_workflows where enabled and trigger = 'schedule'`,
  );
  let queued = 0;
  for (const flow of due) {
    const key = scheduleDue(flow.schedule as WorkflowSchedule, localNow(PLATFORM_ZONE, now));
    if (!key) continue;
    const rows = await db().execute(sql`
      insert into commerce.platform_workflow_runs (workflow_id, event, event_key) values (${flow.id}::uuid, 'schedule', ${key})
      on conflict on constraint platform_workflow_runs_once_key do nothing
      returning id
    `);
    queued += rows.length;
  }
  return queued;
}

/**
 * Runs what is due: today's schedules queued, then each pending run claimed for five minutes (two runs never take one), its event read as it
 * is now, its conditions checked and its actions run in order. Never throws for one run.
 */
export async function runPlatformWorkflows(limit = 25, now = new Date()): Promise<{ runs: number; matched: number }> {
  await queuePlatformScheduledRuns(now);
  const claimed = await typedRows(
    z.object({
      id: col.uuid,
      workflow_id: col.uuid,
      event: col.text,
      subject_id: col.uuid.nullable(),
      created_at: col.timestamp,
      name: col.text,
      conditions: z.unknown(),
      actions: z.unknown(),
    }),
    sql`
      with due as (
        select r.id from commerce.platform_workflow_runs r
        where r.status = 'pending' and (r.claimed_until is null or r.claimed_until < now())
        order by r.created_at limit ${limit}
        for update skip locked
      ), claimed as (
        update commerce.platform_workflow_runs r set claimed_until = now() + interval '5 minutes' from due where r.id = due.id
        returning r.id, r.workflow_id, r.event, r.subject_id, r.created_at
      )
      select c.*, w.name, w.conditions, w.actions from claimed c join commerce.platform_workflows w on w.id = c.workflow_id
    `,
  );
  let matchedCount = 0;
  for (const run of claimed) {
    try {
      const actions = (run.actions as WorkflowAction[]) ?? [];
      const conditions = (run.conditions as WorkflowCondition[]) ?? [];
      const data = run.event === "schedule" ? {} : await platformPayload({ id: run.id, event: run.event, subjectId: run.subject_id, createdAt: run.created_at });
      const matched = data !== null && workflowMatches(conditions, data);
      const outcomes: ActionOutcome[] = [];
      if (matched) {
        matchedCount++;
        const allowed = new Set(PLATFORM_WORKFLOWS.actionsFor(run.event));
        for (const [index, action] of actions.entries()) {
          if (!allowed.has(action.kind)) {
            outcomes.push({ kind: action.kind, ok: false, problem: "invalid" });
            continue;
          }
          outcomes.push(
            await act({ id: run.id, event: run.event, subjectId: run.subject_id, name: run.name }, action, index).catch((error: unknown) => {
              log("error", "platform_workflows.action_failed", { workflowId: run.workflow_id, action: action.kind }, error);
              return { kind: action.kind, ok: false, problem: "failed" };
            }),
          );
        }
      }
      await db().execute(sql`
        update commerce.platform_workflow_runs set status = ${outcomes.some((o) => !o.ok) ? "failed" : "done"}, matched = ${matched},
          outcome = ${JSON.stringify({ found: data !== null, actions: outcomes })}::jsonb, finished_at = now(), claimed_until = null
        where id = ${run.id}::uuid
      `);
    } catch (error) {
      log("error", "platform_workflows.run_failed", { workflowId: run.workflow_id }, error);
    }
  }
  await db().execute(sql`delete from commerce.platform_workflow_runs where created_at < now() - interval '90 days'`);
  return { runs: claimed.length, matched: matchedCount };
}

export type PlatformWorkflowRun = { id: string; at: string; event: string; status: string; matched: boolean | null; actions: ActionOutcome[] };

/** A workflow's latest runs, newest first. */
export async function platformWorkflowRuns(workflowId: string, limit = 10): Promise<PlatformWorkflowRun[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, created_at: col.timestamp, event: col.text, status: col.text, matched: z.boolean().nullable(), outcome: z.unknown().nullable() }),
    sql`
      select id, created_at, event, status, matched, outcome from commerce.platform_workflow_runs
      where workflow_id = ${workflowId}::uuid order by created_at desc limit ${limit}
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
