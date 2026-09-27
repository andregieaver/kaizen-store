"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { inviteHost, setHostDisabled, updateHost } from "@/server/hosts";

/** Hosts change what the store earns (D71): owners only. */
async function requireOwner(storeSlug: string) {
  const member = await requireMember(storeSlug);
  return member.role === "owner" ? member : null;
}

const fields = (formData: FormData) => ({
  name: formData.get("name"),
  email: formData.get("email"),
  commissionPercent: formData.get("commissionPercent"),
  vatRegistered: formData.get("vatRegistered") === "on",
});

/** Adds a host; they sign in with the email given, and land in their own area. */
export async function inviteHostAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requireOwner(storeSlug);
  if (!owner) return { status: "error", messages: ["Only the store's owners add hosts."] };
  const result = await inviteHost(owner, fields(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${storeSlug}/hosts/${result.id}`);
}

export async function updateHostAction(storeSlug: string, hostId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requireOwner(storeSlug);
  if (!owner) return { status: "error", messages: ["Only the store's owners change hosts."] };
  if (!z.uuid().safeParse(hostId).success) return { status: "error", messages: ["The host is no longer in the store."] };
  const result = await updateHost(owner, hostId, fields(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  // The host's name is shown on their listings.
  updateTag(catalogTag(owner.store.id));
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

export async function setHostDisabledAction(storeSlug: string, hostId: string, disabled: boolean): Promise<void> {
  const owner = await requireOwner(storeSlug);
  if (owner && z.uuid().safeParse(hostId).success) await setHostDisabled(owner, hostId, disabled);
  refresh();
}
