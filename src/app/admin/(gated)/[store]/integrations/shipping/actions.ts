"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { CARRIERS } from "@/lib/shipping-carriers";
import { requireMember } from "@/server/auth";
import { checkBring } from "@/server/bring-shipping";
import { removeCarrier, saveCarrier } from "@/server/shipping-carriers";

/** A carrier's agreement holds the store's own keys, so only an owner saves or forgets it (D133). */
export async function saveCarrierAction(storeSlug: string, carrier: string, _state: FormState, formData: FormData): Promise<FormState> {
  const { store, role, account } = await requireMember(storeSlug);
  if (role !== "owner") return { status: "error", messages: ["Only an owner can set up a shipping carrier."] };
  const info = CARRIERS.find((c) => c.id === carrier);
  if (!info) return { status: "error", messages: ["Unknown carrier."] };
  const result = await saveCarrier(account.id, store.id, carrier, {
    environment: formData.get("environment"),
    countries: formData.getAll("countries"),
    fields: Object.fromEntries(info.fields.map((field) => [field.key, formData.get(`field:${field.key}`)])),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [info.available.length > 0 ? "Saved. Check the connection below." : "Saved. The connection to the carrier is being built; your details are ready for it."] };
}

export async function removeCarrierAction(storeSlug: string, carrier: string): Promise<void> {
  const { store, role, account } = await requireMember(storeSlug);
  if (role !== "owner") return;
  await removeCarrier(account.id, store.id, carrier);
  redirect(`/admin/${store.slug}/integrations`);
}

/** Asks the carrier whether the store's agreement works (D134). Only Posten / Bring has a connection so far. */
export async function checkCarrierAction(storeSlug: string, carrier: string): Promise<FormState> {
  const { store, role, account } = await requireMember(storeSlug);
  if (role !== "owner") return { status: "error", messages: ["Only an owner can check a shipping carrier."] };
  if (carrier !== "bring") return { status: "error", messages: ["This carrier's connection is not built yet."] };
  const result = await checkBring(account.id, store.id);
  refresh();
  return result.ok
    ? { status: "ok", messages: ["Bring accepted your agreement."] }
    : { status: "error", messages: [result.problem] };
}
