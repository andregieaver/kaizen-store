/**
 * The customer file (D165, `docs/wave-2-data.md` 2.4, 2.5, 4.3), pure. One row per customer as the Customers page lists them: everyone with
 * an account and every guest with a paid order, one per email (case-insensitive). The server reads them (the store id on every statement,
 * an erased person's order is not a customer) and passes plain rows in; the custom fields staff entered about customers come as text per
 * field NAME in the same shape as the product file's (`field-csv.ts`), read in one batch.
 *
 * The file never carries a password hash, an auth id, a session, a sign-in code, an avatar path, a referral code or a token: the input
 * has no field for any of them. `marketing_consent` is ALWAYS the word `not_recorded`: Kaizen records no consent to marketing yet (wave 5
 * builds the subscriber list with consent, source and date), and a blank or a `false` would claim one. `email_opt_out` is true when the
 * address is on the store's unsubscribe list (`commerce.email_opt_outs`). The file is not a mailing list; the page says so.
 */
import { addressableFieldsOf, fieldCell } from "./field-csv-cells";
import type { Cell } from "./csv";
import type { FieldDef } from "./custom-fields";

export const CONSENT_NOT_RECORDED = "not_recorded";

export type CustomerRecord = {
  /** The customer's id; null for a guest (a paid order and no account). */
  id: string | null;
  email: string;
  name: string | null;
  phone: string | null;
  account: "verified" | "unverified" | "none";
  locale: string | null;
  createdAt: string | null;
  lastOrderAt: string | null;
  ordersPaid: number;
  /** The account's address, else the latest paid order's shipping address. */
  address: { line1: string | null; line2: string | null; postalCode: string | null; city: string | null; country: string | null };
  companyName: string | null;
  organisationNumber: string | null;
  customerGroup: string | null;
  company: string | null;
  companyRole: string | null;
  /** The address is on the store's unsubscribe list. */
  emailOptOut: boolean;
  /** The customer exists only in a copied store's history. */
  copied: boolean;
  /** Plain custom field values as cell text, by the field's name (translatable text is the primary language's). */
  fields?: Record<string, string>;
};

const FIXED = [
  "customer_id", "email", "name", "phone", "account", "locale", "created_at", "last_order_at", "orders_paid",
  "address_line1", "address_line2", "address_postal_code", "address_city", "address_country",
  "company_name", "organisation_number", "customer_group", "company", "company_role", "email_opt_out", "marketing_consent", "copied",
] as const;

/** The header row: the fixed columns, then `field:{name}` per plain customer field with a name of its own. */
export function customerColumns(fields: readonly FieldDef[]): string[] {
  return [...FIXED, ...addressableFieldsOf(fields).map((d) => `field:${d.name}`)];
}

const text = (v: string | null | undefined): Cell => (v === null || v === undefined || v === "" ? null : v);
const iso = (at: string | null): string | null => (at ? new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z") : null);

/** The rows (no header) of some customers, in the order given. */
export function customerRows(customers: readonly CustomerRecord[], fields: readonly FieldDef[]): Cell[][] {
  const header = customerColumns(fields);
  const defs = addressableFieldsOf(fields);
  return customers.map((c) => {
    const cells: Record<string, Cell> = {
      customer_id: c.id,
      email: c.email,
      name: text(c.name),
      phone: text(c.phone),
      account: c.account,
      locale: text(c.locale),
      created_at: iso(c.createdAt),
      last_order_at: iso(c.lastOrderAt),
      orders_paid: c.ordersPaid,
      address_line1: text(c.address.line1),
      address_line2: text(c.address.line2),
      address_postal_code: text(c.address.postalCode),
      address_city: text(c.address.city),
      address_country: text(c.address.country),
      company_name: text(c.companyName),
      organisation_number: text(c.organisationNumber),
      customer_group: text(c.customerGroup),
      company: text(c.company),
      company_role: text(c.companyRole),
      email_opt_out: c.emailOptOut ? "true" : "false",
      marketing_consent: CONSENT_NOT_RECORDED,
      copied: c.copied ? "true" : "false",
    };
    for (const d of defs) cells[`field:${d.name}`] = fieldCell(d, c.fields?.[d.name] ?? "");
    return header.map((h) => cells[h] ?? null);
  });
}

export const customerFileRows = (customers: readonly CustomerRecord[], fields: readonly FieldDef[]): Cell[][] => [customerColumns(fields), ...customerRows(customers, fields)];

/** Customers one per email, case-insensitively: the first of each address (the caller orders them: an account before a guest). */
export function onePerEmail<T extends { email: string }>(customers: readonly T[]): T[] {
  const seen = new Set<string>();
  return customers.filter((c) => {
    const key = c.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
