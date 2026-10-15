"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { checkPermission } from "@/server/permissions";
import { deleteRule, listRules, orderRules, saveRule, setRuleEnabled } from "@/server/order-rules";

const NO_ACCESS = "You do not have access to change the store's automation.";

/**
 * The automation rules' actions (wave 3, D238, `docs/wave-3-notifications.md` 2.5): every one `settings:write`, asked here; `saveRule()` checks the rule
 * with `orderRuleInput` again and keeps products and countries to the store's own, and each server function writes its audit entry.
 */

/** Creates (`ruleId` null) or changes a rule; the editor sends the shape `orderRuleInput` reads. */
export async function saveRuleAction(storeSlug: string, ruleId: string | null, input: unknown): Promise<{ ok: true; id: string; message: string } | { ok: false; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: NO_ACCESS };
  const result = await saveRule(member.store.id, ruleId, input, member.account.id);
  if (!result.ok) return { ok: false, message: result.message };
  refresh();
  return { ok: true, id: result.rule.id, message: "Saved." };
}

/** Switches a rule on or off (the list's form). */
export async function switchRuleAction(storeSlug: string, ruleId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const enabled = form.get("enabled") === "on";
  const result = await setRuleEnabled(member.store.id, ruleId, enabled, member.account.id);
  if (!result.ok) return { status: "error", messages: ["This rule no longer exists."] };
  refresh();
  return { status: "ok", messages: [enabled ? "Switched on." : "Switched off."] };
}

/** *Move up* or *Move down*: the store's rules in their new order, read under the server's lock again by `orderRules()`. */
export async function moveRuleAction(storeSlug: string, ruleId: string, direction: "up" | "down"): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const ids = (await listRules(member.store.id)).map((r) => r.id);
  const at = ids.indexOf(ruleId);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return { status: "error", messages: ["The rule cannot move that way."] };
  [ids[at], ids[to]] = [ids[to], ids[at]];
  const result = await orderRules(member.store.id, ids, member.account.id);
  if (!result.ok) return { status: "error", messages: [result.message] };
  refresh();
  return { status: "ok", messages: ["Moved."] };
}

/** Deletes a rule for good (its runs in the log keep its name). */
export async function deleteRuleAction(storeSlug: string, ruleId: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  if (form.get("confirm") !== "1") return { status: "error", messages: ["Confirm that the rule should be deleted."] };
  const result = await deleteRule(member.store.id, ruleId, member.account.id);
  if (!result.ok) return { status: "error", messages: ["This rule no longer exists."] };
  refresh();
  return { status: "ok", messages: ["Deleted."] };
}
