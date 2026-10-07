"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { parseStarterDetails } from "@/lib/store-starters";
import { requirePlatformAdmin } from "@/server/auth";
import { STARTERS_TAG, createStarter, joinStarter, moveStarter, setStarterPublished, updateStarter } from "@/server/store-starters";

/** The store template form's fields, as the server reads them. */
const detailsOf = (formData: FormData) =>
  parseStarterDetails({
    title: formData.get("title"),
    summary: formData.get("summary"),
    description: formData.get("description"),
    category: formData.get("category"),
    pictureUrl: formData.get("pictureUrl"),
  });

/** A new store template (D175): its store is copied from the default template, with the admin as owner; unpublished until they say. */
export async function createStarterAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase() || suggestSlug(details.details.title);
  const result = await createStarter(admin, { slug, details: details.details });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [`${details.details.title} is made, unpublished. Set it up in its admin (${result.slug}), then publish it.`],
  };
}

/** A store template's details. */
export async function updateStarterAction(starterId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const details = detailsOf(formData);
  if (!details.ok) return { status: "error", messages: details.problems };
  const result = await updateStarter(admin, starterId, details.details);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

/** Offers a store template to owners and the sign-up form, or stops offering it. */
export async function publishStarterAction(starterId: string, published: boolean): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await setStarterPublished(admin, starterId, published);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: [published ? "Published: owners can start from it now." : "Unpublished: no new store starts from it."] };
}

/** Moves a store template up or down in the order owners see. */
export async function moveStarterAction(starterId: string, direction: "up" | "down"): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await moveStarter(admin, starterId, direction === "up" ? "up" : "down");
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(STARTERS_TAG);
  refresh();
  return { status: "ok", messages: ["Moved."] };
}

/** Opens the template's store admin, making the platform admin an owner of it first if they are not a member yet. */
export async function openStarterAdminAction(starterId: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await joinStarter(admin, starterId);
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${result.slug}`);
}
