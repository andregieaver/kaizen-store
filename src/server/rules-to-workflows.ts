import "server-only";

import { db } from "@/db/client";
import { mainCurrency } from "@/lib/markets";
import { ruleToWorkflow, type KeptWhy } from "@/lib/rules-to-workflows";
import { WORKFLOWS_MAX } from "@/lib/workflows";

import { audit } from "./auth";
import { listRules, markRuleMoved, rulesToMove } from "./order-rules";
import { storeById } from "./shopper-emails";
import { insertMovedWorkflow, lockedWorkflowCount, workflowCount } from "./workflow-moves";

/**
 * Order rules folded into workflows (ecosystem plan E3.3, D718): a store's rules written as the workflows that do the same
 * (`ruleToWorkflow()`), by code, once. Offered on Settings → Automation with one press, and done by itself when an owner opens that page and
 * every rule can move. Idempotent: a moved rule is a workflow with its id, never moved twice; a rule that cannot move stays a rule, and the
 * order-rules engine keeps running it. Audited `automation.rules_moved` (counts only).
 */

export type MovedRule = { id: string; name: string };
export type KeptRule = { id: string; name: string; why: KeptWhy };
export type MoveOutcome = { moved: MovedRule[]; kept: KeptRule[] };

async function currencyOf(storeId: string): Promise<string> {
  const store = await storeById(storeId);
  if (!store) throw new Error("rules-to-workflows: the store was not found");
  return mainCurrency(store);
}

/** What a move would do now, doing nothing: the rules that would become workflows, and those that would stay rules with why. */
export async function rulesMovePlan(storeId: string): Promise<MoveOutcome> {
  const [rules, currency, workflows] = await Promise.all([listRules(storeId), currencyOf(storeId), workflowCount(storeId)]);
  const out: MoveOutcome = { moved: [], kept: [] };
  for (const rule of rules) {
    const move = ruleToWorkflow(rule, currency);
    if (!move.ok) out.kept.push({ id: rule.id, name: rule.name, why: move.why });
    else if (workflows + out.moved.length >= WORKFLOWS_MAX) out.kept.push({ id: rule.id, name: rule.name, why: "limit" });
    else out.moved.push({ id: rule.id, name: rule.name });
  }
  return out;
}

/**
 * Moves every rule of the store that can be a workflow, in the rules' order, in one transaction: the workflow made with the rule's id (on when
 * the rule was), and the rule switched off and marked moved for the engine. A store that would pass `WORKFLOWS_MAX` keeps the rest as rules.
 */
export async function moveRulesToWorkflows(storeId: string, accountId: string | null): Promise<MoveOutcome> {
  const currency = await currencyOf(storeId);
  const outcome = await db().transaction(async (tx): Promise<MoveOutcome> => {
    let count = await lockedWorkflowCount(tx, storeId);
    const out: MoveOutcome = { moved: [], kept: [] };
    for (const rule of await rulesToMove(tx, storeId)) {
      const move = ruleToWorkflow(rule, currency);
      if (!move.ok) {
        out.kept.push({ id: rule.id, name: rule.name, why: move.why });
        continue;
      }
      if (count >= WORKFLOWS_MAX) {
        out.kept.push({ id: rule.id, name: rule.name, why: "limit" });
        continue;
      }
      if (await insertMovedWorkflow(tx, { storeId, id: rule.id, workflow: move.workflow, enabled: rule.enabled, createdBy: rule.createdBy, updatedBy: rule.updatedBy })) count++;
      await markRuleMoved(tx, storeId, rule.id);
      out.moved.push({ id: rule.id, name: rule.name });
    }
    return out;
  });
  if (outcome.moved.length > 0) await audit(accountId, storeId, "automation.rules_moved", { moved: outcome.moved.length, kept: outcome.kept.length });
  return outcome;
}
