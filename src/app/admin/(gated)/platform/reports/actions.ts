"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { setScreening } from "@/server/content-moderation";
import { decideContentReport } from "@/server/content-reports";

/** Decides a notice of illegal content (DSA art. 16(5), D411): the outcome, what was restricted and why. */
export async function decideReportAction(reportId: string, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").reports;
  const done = await decideContentReport(admin, reportId, {
    outcome: form.get("outcome") === "actioned" ? "actioned" : "no_action",
    decision: String(form.get("decision") ?? ""),
    actionTaken: String(form.get("actionTaken") ?? ""),
  });
  if (!done.ok) return { status: "error", messages: [w.problems[done.problem]] };
  refresh();
  return { status: "ok", messages: [w.done] };
}

/** Turns Kaizena Flow's own AI check of listings on or off (D411 part 2); a platform admin's alone, since it costs model calls. */
export async function saveScreeningAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").reports;
  await setScreening(admin, form.get("on") === "on");
  refresh();
  return { status: "ok", messages: [w.screening.saved] };
}
