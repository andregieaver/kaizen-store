"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { postIncident, updateIncident } from "@/server/status";

/** Posts an incident on the status page (D360) and emails its subscribers. */
export async function postIncidentAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").status;
  const done = await postIncident(admin, {
    title: String(form.get("title") ?? ""),
    titleNb: String(form.get("titleNb") ?? ""),
    impact: String(form.get("impact") ?? ""),
    components: form.getAll("components").map(String),
    body: String(form.get("body") ?? ""),
    bodyNb: String(form.get("bodyNb") ?? ""),
  });
  if (!done.ok) return { status: "error", messages: [w.problems[done.problem]] };
  refresh();
  return { status: "ok", messages: [fillWords(w.posted, { n: done.emailed })] };
}

/** Posts an update to an incident, resolving it with Resolved. */
export async function updateIncidentAction(incidentId: string, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "platform").status;
  const done = await updateIncident(admin, incidentId, {
    status: String(form.get("status") ?? ""),
    body: String(form.get("body") ?? ""),
    bodyNb: String(form.get("bodyNb") ?? ""),
  });
  if (!done.ok) return { status: "error", messages: [w.problems[done.problem]] };
  refresh();
  return { status: "ok", messages: [fillWords(w.updated, { n: done.emailed })] };
}
