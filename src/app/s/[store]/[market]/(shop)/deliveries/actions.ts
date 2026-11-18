"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";
import {
  addressInput,
  setListAddress,
  setListQuantity,
  setListStatus,
  setSkip,
  startCardSetup,
  startDeliveryPayment,
  type StartProblem,
} from "@/server/standing-orders";

/**
 * A shopper's weekly delivery (D102): every change is to the signed-in
 * customer's own list, in a store that has weekly deliveries on.
 */

const uuid = z.uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function signedIn(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop?.store.deliveriesOn) return null;
  const customer = await getCustomer(shop.store.id);
  return customer ? { shop, customer } : null;
}

async function origin(): Promise<string> {
  const header = (await headers()).get("origin");
  return header ? new URL(header).origin : siteUrl();
}

export type StartState = { problem: StartProblem | null };

/** Starts the weekly delivery, or changes its day, address or card: off to Stripe to save the card. */
export async function startDeliveryAction(storeSlug: string, marketSlug: string, _state: StartState, form: FormData): Promise<StartState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) return { problem: "schedule" };
  const address = addressInput.safeParse({
    name: form.get("name") ?? "",
    line1: form.get("line1") ?? "",
    line2: form.get("line2") ?? "",
    postalCode: form.get("postalCode") ?? "",
    city: form.get("city") ?? "",
    phone: form.get("phone") ?? "",
  });
  if (!address.success) return { problem: "address" };
  const scheduleId = String(form.get("scheduleId") ?? "");
  if (!uuid.safeParse(scheduleId).success) return { problem: "schedule" };
  const { shop, customer } = found;
  const result = await startCardSetup(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    customer,
    { scheduleId, address: address.data, consent: form.get("consent") === "on" },
    await origin(),
  );
  if (!result.ok) return { problem: result.problem };
  redirect(result.url);
}

/** Sets how many of an item the list holds; 0 takes it off. */
export async function setDeliveryQuantityAction(storeSlug: string, marketSlug: string, variantId: string, quantity: number): Promise<void> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found || !uuid.safeParse(variantId).success || !Number.isInteger(quantity)) return;
  await setListQuantity(found.shop.store.id, found.customer.id, variantId, Math.max(0, quantity));
  refresh();
}

export async function skipDeliveryAction(storeSlug: string, marketSlug: string, day: string, skip: boolean): Promise<void> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found || !date.safeParse(day).success) return;
  await setSkip(found.shop.store.id, found.customer.id, day, skip);
  refresh();
}

export async function deliveryStatusAction(storeSlug: string, marketSlug: string, change: "pause" | "resume" | "cancel"): Promise<void> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found || !["pause", "resume", "cancel"].includes(change)) return;
  await setListStatus(found.shop.store.id, found.customer.id, change);
  refresh();
}

export type AddressState = { ok: boolean | null };

export async function deliveryAddressAction(storeSlug: string, marketSlug: string, _state: AddressState, form: FormData): Promise<AddressState> {
  const found = await signedIn(storeSlug, marketSlug);
  const address = addressInput.safeParse({
    name: form.get("name") ?? "",
    line1: form.get("line1") ?? "",
    line2: form.get("line2") ?? "",
    postalCode: form.get("postalCode") ?? "",
    city: form.get("city") ?? "",
    phone: form.get("phone") ?? "",
  });
  if (!found || !address.success) return { ok: false };
  const result = await setListAddress(found.shop.store.id, found.customer.id, address.data);
  refresh();
  return { ok: result.ok };
}

/** Pays a delivery the card did not: off to Stripe, back to the list. */
export async function payDeliveryAction(storeSlug: string, marketSlug: string, orderId: string): Promise<void> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found || !uuid.safeParse(orderId).success) return;
  const { shop, customer } = found;
  const url = await startDeliveryPayment(
    { storeId: shop.store.id, storeSlug: shop.store.slug, market: shop.market },
    customer.id,
    orderId,
    await origin(),
  );
  redirect(url ?? marketPath(shop.store.slug, shop.market.slug, "/deliveries"));
}

export type AddToDeliveryState = { outcome: "idle" | "added" | "sign_in" | "no_list" | "not_listable" | "full" | "error" };

/** The product page's button: the chosen variant onto the shopper's list. */
export async function addToDeliveryAction(_state: AddToDeliveryState, form: FormData): Promise<AddToDeliveryState> {
  const shop = await resolveShop(String(form.get("store") ?? ""), String(form.get("market") ?? ""));
  const variantId = String(form.get("variantId") ?? "");
  if (!shop?.store.deliveriesOn || !uuid.safeParse(variantId).success) return { outcome: "error" };
  const customer = await getCustomer(shop.store.id);
  if (!customer) return { outcome: "sign_in" };
  const result = await setListQuantity(shop.store.id, customer.id, variantId, 1, { add: true });
  if (result.ok) return { outcome: "added" };
  return { outcome: result.problem === "no_list" ? "no_list" : result.problem === "full" ? "full" : "not_listable" };
}
