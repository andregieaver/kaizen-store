"use server";

import { redirect } from "next/navigation";
import { updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember, type Membership } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
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
}

function nextStep(storeSlug: string, step: SetupStepId): never {
  const index = SETUP_STEPS.findIndex((s) => s.id === step);
  const next = SETUP_STEPS[index + 1];
  redirect(`/admin/${storeSlug}/setup/${next ? next.id : "launch"}`);
}

const optional = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || null);

const detailsInput = z.object({
  name: z.string().trim().min(1, "Enter the store's name.").max(80, "Keep the store name under 80 characters."),
  legalName: z.string().trim().min(1, "Enter the business's legal name.").max(200),
  organisationNumber: optional,
  contactEmail: z.email("Enter a contact email shoppers can write to."),
  postalAddress: z.string().trim().min(5, "Enter the business address.").max(300),
  country: z.string().regex(/^[A-Z]{2}$/, "Choose the country the business is registered in."),
});

export async function saveDetailsAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const parsed = detailsInput.safeParse(Object.fromEntries(formData));
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
