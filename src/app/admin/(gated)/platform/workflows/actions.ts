"use server";

import { refresh } from "next/cache";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { AnyWorkflowInput } from "@/lib/workflows";
import { requirePlatform } from "@/server/auth";
import { deletePlatformWorkflow, getPlatformWorkflow, savePlatformWorkflow, switchPlatformWorkflow, testPlatformWorkflow } from "@/server/platform-workflows";

/** Kaizena Flow's workflows (D516) act for the platform, so they are a platform owner's (the settings area, D510). */
const owner = () => requirePlatform("settings");

export async function savePlatformWorkflowAction(id: string | null, input: AnyWorkflowInput): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const admin = await owner();
  const saved = await savePlatformWorkflow(admin, id, input);
  if (saved.ok) refresh();
  return saved.ok ? { ok: true } : saved;
}

export async function testPlatformWorkflowAction(id: string) {
  const admin = await owner();
  const w = adminText(adminLangOf(admin.adminLocale), "notifications").workflows;
  const tested = await testPlatformWorkflow(admin, id);
  refresh();
  if (!tested.ok) return { ok: false as const, message: w.noRuns };
  const flow = await getPlatformWorkflow(id);
  return { ...tested, schedule: flow?.trigger === "schedule" };
}

export async function switchPlatformWorkflowAction(id: string, on: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = await owner();
  const w = adminText(adminLangOf(admin.adminLocale), "notifications").workflows;
  const switched = await switchPlatformWorkflow(admin, id, on);
  refresh();
  return switched === "ok" ? { ok: true } : { ok: false, message: switched === "untested" ? w.untested : w.noRuns };
}

export async function deletePlatformWorkflowAction(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const admin = await owner();
  await deletePlatformWorkflow(admin, id);
  refresh();
  return { ok: true };
}
