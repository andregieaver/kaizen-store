"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { switchAgentChannel, switchFeedsOff, switchFeedsOn } from "@/server/feed-settings";
import { setShoppingAgents } from "@/server/shopping-agent-settings";
import { storeTag } from "@/server/stores";
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

/** The *Shopping agents* switch (D353): the store's UCP profile and MCP endpoint. */
export async function shoppingAgentsAction(storeSlug: string, on: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const w = adminText(adminLangOf(member.account.adminLocale), "marketing").feeds.agents;
  await setShoppingAgents(member.store.id, member.account.id, on === true);
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: [on ? w.turnedOn : w.turnedOff] };
}

/** ChatGPT's product feed (D353), off by default; switching it on turns the feeds on too. */
export async function chatgptFeedAction(storeSlug: string, on: boolean, _state: FormState, _form: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const words = adminText(adminLangOf(member.account.adminLocale), "marketing").feeds;
  const result = await switchAgentChannel(member.store.id, member.account.id, "openai", on === true);
  if (!result.ok) return { status: "error", messages: [words.noKey] };
  refresh();
  return { status: "ok", messages: [on ? words.agents.chatgptTurnedOn : words.agents.chatgptTurnedOff] };
}
