"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { switchFeedsOff, switchFeedsOn } from "@/server/feed-settings";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/** Product feeds (D302): switched on, off and given a new address by anyone who may change marketing. The store is bound. */
async function act(storeSlug: string, kind: "on" | "off" | "renew"): Promise<FormState> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "marketing").feeds;
  if (kind === "off") {
    await switchFeedsOff(member.store.id, member.account.id);
    refresh();
    return { status: "ok", messages: [w.turnedOff] };
  }
  const result = await switchFeedsOn(member.store.id, member.account.id, { renew: kind === "renew" });
  if (!result.ok) return { status: "error", messages: [w.noKey] };
  refresh();
  return { status: "ok", messages: [kind === "renew" ? w.renewed : w.on] };
}

export async function feedsOnAction(storeSlug: string, _state: FormState, _form: FormData): Promise<FormState> {
  return act(storeSlug, "on");
}

export async function feedsOffAction(storeSlug: string, _state: FormState, _form: FormData): Promise<FormState> {
  return act(storeSlug, "off");
}

export async function feedsRenewAction(storeSlug: string, _state: FormState, _form: FormData): Promise<FormState> {
  return act(storeSlug, "renew");
}
