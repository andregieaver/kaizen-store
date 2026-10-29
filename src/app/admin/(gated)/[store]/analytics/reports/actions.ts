"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { problemText } from "@/lib/report-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { deleteReportSchedule, saveReportSchedule } from "@/server/report-schedules";
import { deleteReport, saveReport } from "@/server/saved-reports";

const text = (formData: FormData, key: string): string => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

function specOf(formData: FormData): unknown {
  try {
    return JSON.parse(text(formData, "spec"));
  } catch {
    return null;
  }
}

/**
 * Saves the report on screen (D345): over the saved one it was opened from (`id`), or as a new one (`asNew`). Needs `analytics:write`; the
 * spec is read through the schema and the catalogue again on the server. On success the page opens the saved report.
 */
export async function saveReportAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "customReports").save.needWrite] };
  const words = adminText(adminLangOf(member.account.adminLocale), "customReports");
  const w = words.save;
  const id = text(formData, "id");
  const asNew = text(formData, "asNew") === "1" || id === "";
  const result = await saveReport(member.store.id, member.account.id, { title: text(formData, "title"), spec: specOf(formData) }, asNew ? undefined : id);
  if (!result.ok) {
    if (result.reason === "spec") return { status: "error", messages: (result.problems ?? [{ kind: "no_metric" as const }]).map((p) => problemText(p, words)) };
    return { status: "error", messages: [result.reason === "title" ? w.nameMissing : result.reason === "too_many" ? w.tooMany : w.gone] };
  }
  redirect(`/admin/${member.store.slug}/analytics/reports/view?id=${result.id}&saved=1`);
}

/** Deletes a saved report (D345) and goes back to the list. The figures it showed are not touched. */
export async function deleteReportAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "customReports").save.needWrite] };
  const w = adminText(adminLangOf(member.account.adminLocale), "customReports").save;
  if (!(await deleteReport(member.store.id, member.account.id, text(formData, "id")))) return { status: "error", messages: [w.gone] };
  redirect(`/admin/${member.store.slug}/analytics/reports`);
}

/**
 * Saves the email schedule of a saved report (D395): how often, at what hour and to whom. Needs `analytics:write`; the recipients are checked
 * on the server to be members who may read analytics.
 */
export async function saveReportScheduleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "customReports").save.needWrite] };
  const w = adminText(adminLangOf(member.account.adminLocale), "customReports").schedule;
  const raw = {
    reportId: text(formData, "reportId"),
    frequency: text(formData, "frequency"),
    weekday: text(formData, "weekday"),
    monthDay: text(formData, "monthDay"),
    hour: text(formData, "hour"),
    recipients: formData.getAll("recipients").filter((v): v is string => typeof v === "string"),
    enabled: text(formData, "enabled") === "1",
  };
  const id = text(formData, "id");
  const result = await saveReportSchedule(member.store.id, member.account.id, raw, id === "" ? undefined : id);
  if (!result.ok) return { status: "error", messages: [w.problems[result.problem]] };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** Stops emailing a saved report (D395). */
export async function deleteReportScheduleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [adminText(await actionAdminLang(), "customReports").save.needWrite] };
  const w = adminText(adminLangOf(member.account.adminLocale), "customReports").schedule;
  if (!(await deleteReportSchedule(member.store.id, member.account.id, text(formData, "id")))) return { status: "error", messages: [w.problems.gone] };
  refresh();
  return { status: "ok", messages: [w.removed] };
}
