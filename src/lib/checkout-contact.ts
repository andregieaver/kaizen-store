import { e164Phone } from "./phone";

/**
 * Contact details the checkout asks besides the email (task 1 of `docs/checkout-fields-tasks.md`, D357): each of the phone and a person's name
 * is off, optional or required, the store's choice (`stores.checkout_phone`, `stores.checkout_name`). What is typed is kept on our own order
 * (`orders.billing_address`), never asked of Stripe, so Stripe and Mollie behave alike. Pure and without zod: the pay route reads it (D158).
 */

export const CONTACT_MODES = ["off", "optional", "required"] as const;
export type ContactMode = (typeof CONTACT_MODES)[number];
export const isContactMode = (value: unknown): value is ContactMode => typeof value === "string" && (CONTACT_MODES as readonly string[]).includes(value);

/** The store's choice for each field. */
export type CheckoutContactSettings = { phone: ContactMode; name: ContactMode };
export const CONTACT_OFF: CheckoutContactSettings = { phone: "off", name: "off" };

/** The longest name kept, as Mollie's payer form keeps (`cleanPayer()`). */
export const CONTACT_NAME_MAX = 120;

/**
 * What one order's checkout asks. A local delivery always asks the phone, required: the store's driver calls (D237). The name is asked only
 * when nothing is sent to an address (downloads, bookings, pickup), since the delivery address already holds one.
 */
export function contactAsked(settings: CheckoutContactSettings, order: { ships: boolean; deliveryMethod: "ship" | "pickup" | "local" }): CheckoutContactSettings {
  const addressed = order.ships && order.deliveryMethod !== "pickup";
  return {
    phone: order.deliveryMethod === "local" ? "required" : settings.phone,
    name: addressed ? "off" : settings.name,
  };
}

export type ContactProblem = "name" | "phone";

/**
 * What was typed, checked against what was asked: a required field must be given, a phone must be one (`e164Phone()`, a national number read
 * in the market's `country`), a field not asked is dropped. The phone comes back in E.164.
 */
export function cleanContact(
  input: { name?: unknown; phone?: unknown },
  asked: CheckoutContactSettings,
  country: string | null,
): { ok: true; name: string | null; phone: string | null } | { ok: false; problem: ContactProblem } {
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
  const nameTyped = asked.name === "off" ? "" : text(input.name, CONTACT_NAME_MAX);
  if (asked.name === "required" && !nameTyped) return { ok: false, problem: "name" };
  const phoneTyped = asked.phone === "off" ? "" : text(input.phone, 40);
  let phone: string | null = null;
  if (phoneTyped) {
    phone = e164Phone(phoneTyped, country);
    if (!phone) return { ok: false, problem: "phone" };
  } else if (asked.phone === "required") return { ok: false, problem: "phone" };
  return { ok: true, name: nameTyped || null, phone };
}
