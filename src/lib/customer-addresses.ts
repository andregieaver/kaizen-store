/**
 * Saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1): the pure rules, shared with the browser (no zod: the checkout is a pay
 * route). The server's writer is `src/server/customer-addresses.ts`.
 */

/** At most this many addresses a customer (the database's `customer_addresses_max()` holds the same). */
export const ADDRESSES_MAX = 20;
export const ADDRESS_LABEL_MAX = 40;

/** An address in the shape orders keep. */
export type SavedAddressFields = {
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  /** ISO 3166 alpha-2, upper case. */
  country: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  address: SavedAddressFields;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
};

/** A saved address offered at checkout: plain data for the pay route's picker. */
export type AddressChoice = { id: string; label: string; line1: string; line2: string; postalCode: string; city: string };

const clip = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Cleans what was typed into an address, or names the first missing field. */
export function cleanAddress(raw: Record<string, unknown>): { ok: true; address: SavedAddressFields } | { ok: false; missing: "line1" | "postalCode" | "city" | "country" } {
  const address: SavedAddressFields = {
    name: clip(raw.name, 120),
    line1: clip(raw.line1, 200),
    line2: clip(raw.line2, 200) || null,
    postalCode: clip(raw.postalCode, 20),
    city: clip(raw.city, 100),
    country: clip(raw.country, 10).toUpperCase(),
  };
  if (!address.line1) return { ok: false, missing: "line1" };
  if (!address.postalCode) return { ok: false, missing: "postalCode" };
  if (!address.city) return { ok: false, missing: "city" };
  if (!/^[A-Z]{2}$/.test(address.country)) return { ok: false, missing: "country" };
  return { ok: true, address };
}

/** A shopper's label for an address, cleaned: one line, at most `ADDRESS_LABEL_MAX` characters. */
export const cleanLabel = (raw: unknown): string => clip(typeof raw === "string" ? raw.replace(/\s+/g, " ") : "", ADDRESS_LABEL_MAX);

/** The address on one line: "Storgata 1, 0150 Oslo". */
export function addressLine(a: Pick<SavedAddressFields, "line1" | "line2" | "postalCode" | "city">): string {
  return [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** The saved addresses checkout may offer for a delivery to `country` (D237: only the market's country), default first, as plain data. */
export function choicesFor(addresses: SavedAddress[], country: string): AddressChoice[] {
  const code = country.toUpperCase();
  return addresses
    .filter((a) => a.address.country === code)
    .sort((a, b) => Number(b.isDefaultShipping) - Number(a.isDefaultShipping))
    .map((a) => ({
      id: a.id,
      label: a.label ? `${a.label}: ${addressLine(a.address)}` : addressLine(a.address),
      line1: a.address.line1,
      line2: a.address.line2 ?? "",
      postalCode: a.address.postalCode,
      city: a.address.city,
    }));
}
