"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { CHECKOUT_COUNTRIES, CHECKOUT_PRICING, parseCheckoutSettings } from "@/lib/delivery-options";
import { CARRIERS, isCarrierId } from "@/lib/shipping-carriers";
import { checkOwnerRole } from "@/server/permissions";
import { checkCarrier } from "@/server/bring-shipping";
import { CHECKOUT_SERVICES, saveCheckoutSettings } from "@/server/delivery-options";
import { getCarrier, removeCarrier, saveCarrier } from "@/server/shipping-carriers";

/** A carrier's agreement holds the store's own keys, so only an owner saves or forgets it (D133). */
export async function saveCarrierAction(storeSlug: string, carrier: string, _state: FormState, formData: FormData): Promise<FormState> {
  const held = await checkOwnerRole(storeSlug);
  if (!held) return { status: "error", messages: ["Only an owner can set up a shipping carrier."] };
  const { store, account } = held;
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
  const held = await checkOwnerRole(storeSlug);
  if (!held) return;
  const { store, account } = held;
  await removeCarrier(account.id, store.id, carrier);
  redirect(`/admin/${store.slug}/integrations`);
}

/** Asks the carrier whether the store's agreement works (D134, D136). Posten / Bring and PostNord have connections so far. */
export async function checkCarrierAction(storeSlug: string, carrier: string): Promise<FormState> {
  const held = await checkOwnerRole(storeSlug);
  if (!held) return { status: "error", messages: ["Only an owner can check a shipping carrier."] };
  const { store, account } = held;
  const info = CARRIERS.find((c) => c.id === carrier);
  if (!info || info.available.length === 0) return { status: "error", messages: ["This carrier's connection is not built yet."] };
  const result = await checkCarrier(account.id, store.id, info.id);
  refresh();
  return result.ok
    ? { status: "ok", messages: [`${info.name} accepted your agreement.`] }
    : { status: "error", messages: [result.problem] };
}

/**
 * What the store offers at checkout with a carrier (D135): on or off, which services, what is added to the carrier's
 * price, the basket value over which they are free and the weight of a parcel when the goods have none. Owners only.
 */
export async function saveCheckoutSettingsAction(storeSlug: string, carrier: string, _state: FormState, formData: FormData): Promise<FormState> {
  const held = await checkOwnerRole(storeSlug);
  if (!held) return { status: "error", messages: ["Only an owner can change what is offered at checkout."] };
  const { store, account } = held;
  if (!isCarrierId(carrier) || !CHECKOUT_SERVICES[carrier]) return { status: "error", messages: ["This carrier has no services at checkout yet."] };
  const saved = await getCarrier(store.id, carrier);
  const parsed = parseCheckoutSettings(formData, CHECKOUT_SERVICES[carrier].map((s) => s.id), {
    pricing: CHECKOUT_PRICING[carrier] ?? "carrier",
    // The countries the store ships to with it that it covers: prices are entered for these.
    countries: (saved?.countries ?? []).filter((c) => (CHECKOUT_COUNTRIES[carrier] ?? []).includes(c)),
  });
  if (!parsed.ok) return { status: "error", messages: parsed.problems };
  const result = await saveCheckoutSettings(account.id, store.id, carrier, parsed.settings);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [parsed.settings.enabled ? "Saved. Shoppers in the chosen countries can now choose these services at checkout." : "Saved. The services are off at checkout."] };
}
