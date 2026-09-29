"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { addToTierByEmail, deleteTier, saveTier, setCustomerTier } from "@/server/customer-tiers";
import type { SaveResult } from "@/server/settings";

const id = z.uuid();

function toState(result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [success] };
}

/** Makes a discount group (id null) or changes one (D108). */
export async function saveGroupAction(storeSlug: string, groupId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (groupId !== null && !id.safeParse(groupId).success) return { status: "error", messages: ["Unknown group."] };
  const result = await saveTier(member, groupId, {
    name: String(form.get("name") ?? ""),
    percent: String(form.get("percent") ?? "") as unknown as number,
    note: String(form.get("note") ?? ""),
    active: groupId === null ? true : form.get("active") === "on",
  });
  if (result.ok && groupId === null && result.id) redirect(`/admin/${member.store.slug}/customer-groups/${result.id}`);
  return toState(result, "Saved.");
}

export async function deleteGroupAction(storeSlug: string, groupId: string): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!id.safeParse(groupId).success) return { status: "error", messages: ["Unknown group."] };
  const result = await deleteTier(member, groupId);
  if (result.ok) redirect(`/admin/${member.store.slug}/customer-groups`);
  return toState(result, "Deleted.");
}

/** Puts the customer with this email in the group; someone with no account gets one made ahead of them. */
export async function addToGroupAction(storeSlug: string, groupId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!id.safeParse(groupId).success) return { status: "error", messages: ["Unknown group."] };
  return toState(await addToTierByEmail(member, groupId, String(form.get("email") ?? "")), "Added to the group.");
}

/** Takes a customer out of their group. */
export async function removeFromGroupAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const customerId = id.safeParse(form.get("customerId"));
  if (!customerId.success) return { status: "error", messages: ["Unknown customer."] };
  return toState(await setCustomerTier(member, customerId.data, null), "Removed from the group.");
}

/** Sets a customer's group from their own page; empty takes them out. */
export async function setCustomerGroupAction(storeSlug: string, customerId: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const group = String(form.get("groupId") ?? "");
  if (!id.safeParse(customerId).success || (group !== "" && !id.safeParse(group).success)) return { status: "error", messages: ["Unknown customer or group."] };
  return toState(await setCustomerTier(member, customerId, group || null), "Saved.");
}
