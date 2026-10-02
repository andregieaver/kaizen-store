"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { dayText } from "@/components/admin/analytics/overview-view";
import { channelLabel } from "@/lib/analytics-traffic";
import { addSpend, deleteSpend } from "@/server/analytics-settings";
import { requireMember } from "@/server/auth";

/**
 * The Marketing page's server actions (D152), bound to the store's slug as their first argument. Each checks the member for itself; any
 * member may enter or remove ad spend, like the rest of the daily work, and the server functions write it to the audit log. The page
 * is refreshed so CAC, ROAS and the list of entries follow the change.
 */

const failed = (messages: string[]): FormState => ({ status: "error", messages });

/** Enters what was spent on a channel (and a campaign in it) on a day: `day`, `channel`, `campaign`, `amount` and `note`. */
export async function addSpendAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const result = await addSpend(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems);
  refresh();
  const day = typeof form.get("day") === "string" ? dayText(String(form.get("day"))) : "that day";
  const channel = typeof form.get("channel") === "string" ? channelLabel(String(form.get("channel"))) : "the channel";
  return {
    status: "ok",
    messages: [
      result.replaced
        ? `Replaced the earlier amount for ${channel} on ${day}. CAC and ROAS follow it.`
        : `Saved the spend for ${channel} on ${day}. CAC and ROAS follow it.`,
    ],
  };
}

/** Takes one entry of spend away (`id`). */
export async function deleteSpendAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const id = form.get("id");
  const result = await deleteSpend(member, typeof id === "string" ? id : "");
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [result.deleted ? "Removed." : "That entry was already gone."] };
}
