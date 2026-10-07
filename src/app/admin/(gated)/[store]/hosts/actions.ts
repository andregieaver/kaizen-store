"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { checkOwnerRole } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { inviteHost, setHostDisabled, updateHost } from "@/server/hosts";
import { featureOffText, featureOn } from "@/lib/store-features";

/** Hosts are part of Stays and rentals (D178): nothing about them changes while it is switched off, whatever a stale page sends. */
const BOOKINGS_OFF: FormState = { status: "error", messages: [featureOffText("bookings")] };

/** Hosts change what the store earns (D71): owners only. */
const requireOwner = (storeSlug: string) => checkOwnerRole(storeSlug);

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
  if (!featureOn(owner.store, "bookings")) return BOOKINGS_OFF;
  const result = await inviteHost(owner, fields(formData));
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${storeSlug}/hosts/${result.id}`);
}

export async function updateHostAction(storeSlug: string, hostId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await requireOwner(storeSlug);
  if (!owner) return { status: "error", messages: ["Only the store's owners change hosts."] };
  if (!featureOn(owner.store, "bookings")) return BOOKINGS_OFF;
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
  if (owner && featureOn(owner.store, "bookings") && z.uuid().safeParse(hostId).success) await setHostDisabled(owner, hostId, disabled);
  refresh();
}
