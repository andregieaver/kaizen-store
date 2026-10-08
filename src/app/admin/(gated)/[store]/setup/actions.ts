"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { readAnswers } from "@/lib/onboarding";
import { nextSetupStep } from "@/lib/setup-steps";
import { storeDetailsInput } from "@/lib/store-details";
import type { FeatureSource } from "@/lib/store-features";
import { type Membership } from "@/server/auth";
import { checkOwnerRole } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { STORES_TAG } from "@/server/seo";
import {
  answerFeatureQuestion,
  archiveDemoProducts,
  completeSetup,
  saveStoreDetails,
  setMarkets,
  type SetupStepId,
} from "@/server/setup";
import { storeTag } from "@/server/stores";

// Setup is the owner's job; every action re-checks that on the server.
async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  return (await checkOwnerRole(storeSlug)) ?? { status: "error", messages: ["Only an owner can set up the store."] };
}

function refreshStore(member: Membership) {
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  // Opening the store, its name and markets show in the sitemap, robots.txt and llms.txt.
  updateTag(STORES_TAG);
}

/** On to the next of the store's steps (they follow its features, D178 step 6). */
function nextStep(storeSlug: string, step: SetupStepId, features: FeatureSource): never {
  redirect(`/admin/${storeSlug}/setup/${nextSetupStep(step, features)}`);
}

/**
 * "What will you sell?" (D178 step 6): the answers become the store's features through `setFeatures()` (owners only, needs held, nothing
 * switched off while customers would be hit, warnings confirmed with the form's tick, each switch audited), and the answer itself is one
 * `store.features_chosen` entry, which is how the wizard knows it was answered. Nothing else is stored; Settings, Features changes it later.
 */
export async function chooseFeaturesAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const answers = readAnswers({ sells: formData.getAll("sells"), extras: formData.getAll("extras") });
  const result = await answerFeatureQuestion(owner, answers, { confirmed: formData.get("confirm") === "on" });
  if (!result.ok) {
    return {
      status: "error",
      messages: result.needsConfirmation ? [...(result.warnings ?? []), "Tick “Switch off what I left out” below to go on, or choose what you need."] : result.problems,
    };
  }
  refreshStore(owner);
  nextStep(storeSlug, "features", result.features);
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
  nextStep(storeSlug, "details", owner.store);
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
  nextStep(storeSlug, "countries", owner.store);
}

export async function removeDemoProductsAction(
  storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  await archiveDemoProducts(owner);
  refreshStore(owner);
  nextStep(storeSlug, "products", owner.store);
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
