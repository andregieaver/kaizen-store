"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { storeDetailsInput } from "@/lib/store-details";
import { requireMember, type Membership } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { STORES_TAG } from "@/server/seo";
import {
  archiveDemoProducts,
  completeSetup,
  saveStoreDetails,
  setMarkets,
  SETUP_STEPS,
  type SetupStepId,
} from "@/server/setup";
import { storeTag } from "@/server/stores";

// Setup is the owner's job; every action re-checks that on the server.
async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  const member = await requireMember(storeSlug);
  return member.role === "owner"
    ? member
    : { status: "error", messages: ["Only an owner can set up the store."] };
}

function refreshStore(member: Membership) {
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  // Opening the store, its name and markets show in the sitemap, robots.txt and llms.txt.
  updateTag(STORES_TAG);
}

function nextStep(storeSlug: string, step: SetupStepId): never {
  const index = SETUP_STEPS.findIndex((s) => s.id === step);
  const next = SETUP_STEPS[index + 1];
  redirect(`/admin/${storeSlug}/setup/${next ? next.id : "launch"}`);
}

export async function saveDetailsAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const parsed = storeDetailsInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", messages: parsed.error.issues.map((issue) => issue.message) };
  }
  await saveStoreDetails(owner, parsed.data);
  refreshStore(owner);
  nextStep(storeSlug, "details");
}

export async function saveCountriesAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const codes = formData
    .getAll("country")
    .map(String)
    .filter((code) => /^[A-Z]{2}$/.test(code));
  const result = await setMarkets(owner, codes);
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshStore(owner);
  nextStep(storeSlug, "countries");
}

export async function removeDemoProductsAction(
  storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  await archiveDemoProducts(owner);
  refreshStore(owner);
  nextStep(storeSlug, "products");
}

export async function openStoreAction(
  storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const result = await completeSetup(owner);
  if (!result.ok) return { status: "error", messages: result.problems };
  refreshStore(owner);
  return { status: "ok", messages: ["Your store is open."] };
}
