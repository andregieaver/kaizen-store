import { cleanAddress, type SavedAddressFields } from "./customer-addresses";

/**
 * Company locations, buyer roles, approvals and PO numbers (wave 6 unit C2, D321, `docs/wave-6-catalogue.md` C.2): the pure rules, shared with
 * the cart (no zod: the cart is a pay route). The server's writer is `src/server/company-locations.ts`.
 */

/** At most this many locations a company (the database's `company_locations_max()` holds the same). */
export const LOCATIONS_MAX = 50;
export const LOCATION_NAME_MAX = 80;
/** A PO number's longest length (the database's `orders_po_number` check holds the same). */
export const PO_NUMBER_MAX = 40;
/** How long an order waits for a company's approval before it is cancelled and its stock let go. */
export const APPROVAL_DAYS = 7;

export const BUYER_ROLES = ["orderer", "approver"] as const;
export type BuyerRole = (typeof BUYER_ROLES)[number];

export const APPROVAL_STATES = ["waiting", "approved", "declined"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export type LocationInput = { name: string; billing: SavedAddressFields | null; shipping: SavedAddressFields | null };

const clip = (value: unknown, max: number): string => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");

/**
 * A location as typed: a name, and a billing and a shipping address, each either left empty or whole. `missing` names the first field that is
 * needed: the name, or an address's line, postal code, city or country.
 */
export function cleanLocation(raw: { name: unknown; billing: Record<string, unknown>; shipping: Record<string, unknown> }):
  | { ok: true; location: LocationInput }
  | { ok: false; missing: "name" | `${"billing" | "shipping"}.${"line1" | "postalCode" | "city" | "country"}` } {
  const name = clip(raw.name, LOCATION_NAME_MAX);
  if (!name) return { ok: false, missing: "name" };
  const side = (which: "billing" | "shipping") => {
    const typed = raw[which];
    const empty = ["line1", "line2", "postalCode", "city"].every((key) => !clip(typed[key], 200));
    if (empty) return { ok: true as const, address: null };
    const cleaned = cleanAddress(typed);
    return cleaned.ok ? { ok: true as const, address: cleaned.address } : { ok: false as const, missing: `${which}.${cleaned.missing}` as const };
  };
  const billing = side("billing");
  if (!billing.ok) return { ok: false, missing: billing.missing };
  const shipping = side("shipping");
  if (!shipping.ok) return { ok: false, missing: shipping.missing };
  return { ok: true, location: { name, billing: billing.address, shipping: shipping.address } };
}

/** A PO number as typed: one line, at most `PO_NUMBER_MAX` characters, no control characters; empty is none. Refused, never cut. */
export function cleanPoNumber(raw: unknown): { ok: true; po: string | null } | { ok: false } {
  const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (text === "") return { ok: true, po: null };
  if (text.length > PO_NUMBER_MAX || /[\u0000-\u001f\u007f]/.test(text)) return { ok: false };
  return { ok: true, po: text };
}

/**
 * Whether an order waits for the company's approval: only an orderer's (an approver's own order never does), only where the company has a limit,
 * and only when the order's total in the limit's currency is over it. A total that cannot be converted (no rate) waits: it is never let through
 * on a guess.
 */
export function needsApproval(role: BuyerRole, limit: { minor: number; currency: string } | null, total: { minor: number | null; currency: string }): boolean {
  if (role !== "orderer" || !limit) return false;
  if (total.minor === null) return true;
  return total.minor > limit.minor;
}
