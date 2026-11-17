import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { WorkflowInput } from "@/lib/workflows";

import { uuidList } from "./sql-arrays";
import { col, typedRow, type Executor } from "./typed-rows";

/**
 * Workflows made from order rules (ecosystem plan E3.3, D718): with `workflows.ts`, the writer of `commerce.workflows` and `workflow_runs`, for
 * the two writes the move needs. Apart from `workflows.ts` because the order-rules engine calls it (and `workflows.ts` reads the rules' facts).
 *
 * - A moved rule's workflow keeps the rule's id, so an order the rule held still names it on its page, its runs in the log keep pointing at
 *   it, and the engine knows the rule moved. It is on when the rule was (it ran as a rule, so it counts as tested) and keeps whoever made and
 *   last saved the rule, so its *Ask the AI manager* runs in the same name as before.
 * - A paid order's event the rules had not handled when its rule moved gets the workflow's run from the engine (`queueMovedRuns()`): once, and
 *   never for an order whose payment already queued the workflow itself.
 */

/** The store's workflows counted under the same lock as `saveWorkflow()`'s, so a move keeps to `WORKFLOWS_MAX` too. */
export async function lockedWorkflowCount(tx: Executor, storeId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('workflows'), hashtext(${storeId}))`);
  const row = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.workflows where store_id = ${storeId}::uuid`, tx);
  return row?.n ?? 0;
}

/** The store's workflows, counted without a lock (what a move would have room for). */
export async function workflowCount(storeId: string): Promise<number> {
  const row = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.workflows where store_id = ${storeId}::uuid`);
  return row?.n ?? 0;
}

/** The workflow a rule became, with the rule's id; false when it was made already. */
export async function insertMovedWorkflow(
  tx: Executor,
  input: { storeId: string; id: string; workflow: WorkflowInput; enabled: boolean; createdBy: string | null; updatedBy: string | null },
): Promise<boolean> {
  const rows = await tx.execute(sql`
    insert into commerce.workflows (id, store_id, name, trigger, schedule, conditions, actions, enabled, version, tested_version, created_by, updated_by)
    values (${input.id}::uuid, ${input.storeId}::uuid, ${input.workflow.name}, ${input.workflow.trigger}, null,
      ${JSON.stringify(input.workflow.conditions)}::jsonb, ${JSON.stringify(input.workflow.actions)}::jsonb, ${input.enabled}, 1,
      ${input.enabled ? 1 : null}::int, ${input.createdBy}::uuid, ${input.updatedBy}::uuid)
    on conflict (id) do nothing
    returning id
  `);
  return rows.length > 0;
}

/**
 * Queues the run of moved rules' workflows (those still on) for one paid order's store event, as if its payment had: dated when it was paid,
 * so it reads the order's tags of then. Never a second run for the same order.
 */
export async function queueMovedRuns(tx: Executor, event: { id: string; storeId: string; subjectId: string }, workflowIds: readonly string[]): Promise<number> {
  if (workflowIds.length === 0) return 0;
  const rows = await tx.execute(sql`
    insert into commerce.workflow_runs (store_id, workflow_id, event, subject_id, event_key, status, created_at)
    select w.store_id, w.id, 'order.paid', ${event.subjectId}::uuid, ${`order.paid:${event.subjectId}:moved`}, 'pending',
      coalesce((select e.occurred_at from commerce.store_events e where e.store_id = w.store_id and e.id = ${event.id}::uuid), now())
    from commerce.workflows w
    where w.store_id = ${event.storeId}::uuid and w.id = any(${uuidList(workflowIds)}) and w.enabled and w.trigger = 'order.paid'
      and not exists (
        select 1 from commerce.workflow_runs r where r.workflow_id = w.id and r.subject_id = ${event.subjectId}::uuid and r.event = 'order.paid'
      )
    on conflict on constraint workflow_runs_once_key do nothing
    returning id
  `);
  return rows.length;
}
