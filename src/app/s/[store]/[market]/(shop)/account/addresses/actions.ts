"use server";

import { redirect } from "next/navigation";

import { cleanAddress } from "@/lib/customer-addresses";
import { marketPath } from "@/lib/paths";
import { removeAddress, saveAddress, setDefaultAddress } from "@/server/customer-addresses";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";

/** The signed-in customer of this store, or a trip back to My account. */
async function signedIn(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  const customer = shop ? await getCustomer(shop.store.id) : null;
  if (!shop || !customer) redirect(shop ? marketPath(shop.store.slug, shop.market.slug, "/account") : "/");
  return { shop, customer, page: marketPath(shop.store.slug, shop.market.slug, "/account/addresses") };
}

/** Adds or changes one of the shopper's saved addresses (D304). */
export async function saveAddressAction(storeSlug: string, marketSlug: string, form: FormData): Promise<void> {
  const { shop, customer, page } = await signedIn(storeSlug, marketSlug);
  const field = (name: string) => String(form.get(name) ?? "");
  const cleaned = cleanAddress({
    name: field("name"),
    line1: field("line1"),
    line2: field("line2"),
    postalCode: field("postalCode"),
    city: field("city"),
    country: field("country") || shop.market.code,
  });
  const id = field("id") || undefined;
  if (!cleaned.ok) redirect(`${page}?problem=missing${id ? `&edit=${encodeURIComponent(id)}` : "&add=1"}`);
  const outcome = await saveAddress(shop.store.id, customer.id, {
    id,
    label: field("label"),
    address: cleaned.address,
    defaultShipping: form.get("defaultShipping") === "on",
    defaultBilling: form.get("defaultBilling") === "on",
  });
  redirect(outcome.ok ? `${page}?done=saved` : `${page}?problem=${outcome.reason === "too_many" ? "too_many" : "missing"}`);
}

export async function removeAddressAction(storeSlug: string, marketSlug: string, id: string): Promise<void> {
  const { shop, customer, page } = await signedIn(storeSlug, marketSlug);
  await removeAddress(shop.store.id, customer.id, id);
  redirect(`${page}?done=removed`);
}

export async function defaultAddressAction(storeSlug: string, marketSlug: string, id: string, kind: "shipping" | "billing"): Promise<void> {
  const { shop, customer, page } = await signedIn(storeSlug, marketSlug);
  await setDefaultAddress(shop.store.id, customer.id, id, kind === "billing" ? "billing" : "shipping");
  redirect(page);
}
