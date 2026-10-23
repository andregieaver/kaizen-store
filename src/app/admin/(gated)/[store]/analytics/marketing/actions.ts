"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { dayText } from "@/components/admin/analytics/overview-view";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { channelLabel } from "@/lib/analytics-traffic";
import { actionAdminLang } from "@/server/admin-request-lang";
import { addSpend, deleteSpend } from "@/server/analytics-settings";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/**
 * The Marketing page's server actions (D152), bound to the store's slug as their first argument. Each checks the member for itself; any
 * member may enter or remove ad spend, like the rest of the daily work, and the server functions write it to the audit log. The page
 * is refreshed so CAC, ROAS and the list of entries follow the change.
 */

const failed = (messages: string[]): FormState => ({ status: "error", messages });

/** Enters what was spent on a channel (and a campaign in it) on a day: `day`, `channel`, `campaign`, `amount` and `note`. */
export async function addSpendAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await addSpend(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems);
  refresh();
  const words = adminText(await actionAdminLang(), "reports");
  const w = words.spendAnswers;
  const raw = form.get("channel");
  const day = typeof form.get("day") === "string" ? dayText(String(form.get("day"))) : w.thatDay;
  const channel = typeof raw === "string" ? ((words.channels as Record<string, string>)[raw] ?? channelLabel(raw)) : w.theChannel;
  return { status: "ok", messages: [fillWords(result.replaced ? w.replaced : w.saved, { channel, day })] };
}

/** Takes one entry of spend away (`id`). */
export async function deleteSpendAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "analytics:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const id = form.get("id");
  const result = await deleteSpend(member, typeof id === "string" ? id : "");
  if (!result.ok) return failed(result.problems);
  refresh();
  const w = adminText(await actionAdminLang(), "reports").spendAnswers;
  return { status: "ok", messages: [result.deleted ? w.removed : w.alreadyGone] };
}
