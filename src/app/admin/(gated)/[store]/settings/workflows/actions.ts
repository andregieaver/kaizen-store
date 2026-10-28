"use server";

import { refresh } from "next/cache";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { WorkflowInput } from "@/lib/workflows";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { deleteWorkflow, getWorkflow, saveWorkflow, switchWorkflow, testWorkflow } from "@/server/workflows";

/** Workflows change what happens in the store, so they are `settings:write` (D356); asking the AI manager is an owner's, checked by the save. */
const noAccess = async () => adminText(await actionAdminLang(), "order").messages.noAccess;

export async function saveWorkflowAction(storeSlug: string, id: string | null, input: WorkflowInput): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const saved = await saveWorkflow(member, id, input);
  if (saved.ok) refresh();
  return saved.ok ? { ok: true } : saved;
}

export async function testWorkflowAction(storeSlug: string, id: string) {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false as const, message: await noAccess() };
  const w = adminText(adminLangOf(member.account.adminLocale), "notifications").workflows;
  const tested = await testWorkflow(member, id);
  refresh();
  if (!tested.ok) return { ok: false as const, message: w.noRuns };
  const flow = await getWorkflow(member.store.id, id);
  return { ...tested, schedule: flow?.trigger === "schedule" };
}

export async function switchWorkflowAction(storeSlug: string, id: string, on: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: await noAccess() };
  const w = adminText(adminLangOf(member.account.adminLocale), "notifications").workflows;
  const switched = await switchWorkflow(member, id, on);
  refresh();
  return switched === "ok" ? { ok: true } : { ok: false, message: switched === "untested" ? w.untested : w.noRuns };
}

export async function deleteWorkflowAction(storeSlug: string, id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { ok: false, message: await noAccess() };
  await deleteWorkflow(member, id);
  refresh();
  return { ok: true };
}
