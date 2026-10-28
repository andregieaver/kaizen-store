/**
 * Staff's own writes on a store's customers (wave 10 unit C, D366), pure: what a staff form or an import row may say about a customer
 * (email, name, phone, address, company), cleaned and checked the same way for both, and the reasons a write or a merge is refused as
 * stable codes the admin's catalogue words (`customers.staff.problems`, `customers.merge.refusals`). No zod and no server imports: the
 * schema reads `CUSTOMER_NOTE_MAX` from here.
 */

/** The longest note staff can write on a customer, in characters (Shopify keeps 5,000 on a merge). */
export const CUSTOMER_NOTE_MAX = 5000;
/** The longest name kept. */
export const CUSTOMER_NAME_MAX = 200;
/** The longest phone number kept. */
export const CUSTOMER_PHONE_MAX = 40;
/** The longest company name kept (as `b2b.ts`). */
export const CUSTOMER_COMPANY_MAX = 120;

const EMAIL = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;

/** An email address as a store keeps it: trimmed, lower case; null when it is not one. */
export function cleanEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return email.length >= 3 && email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** A phone number as typed, one line; empty is none. Digits with `+`, spaces, brackets, dots, slashes and hyphens, at least four digits. */
export function phoneOk(phone: string): boolean {
  if (phone === "") return true;
  return phone.length <= CUSTOMER_PHONE_MAX && /^\+?[0-9 ().\/-]+$/.test(phone) && phone.replace(/\D/g, "").length >= 4;
}

/** One line of text: control characters out, runs of white space as one space, trimmed and cut. */
export const oneLine = (raw: unknown, max: number): string =>
  (typeof raw === "string" ? raw : "")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** A note as kept: control characters but line breaks out, trimmed. Empty or too long is refused by the caller. */
export const cleanNote = (raw: unknown): string =>
  (typeof raw === "string" ? raw : "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cf}\u0000-\u0009\u000b-\u001f\u007f]/gu, "")
    .trim();

export type CustomerAddress = { name: string; line1: string; line2: string | null; postalCode: string; city: string; country: string };

/** What staff may set on a customer. `address` null: no address given (the saved ones stay as they are). `company` null: none. */
export type StaffCustomerInput = {
  email: string;
  name: string;
  phone: string;
  address: CustomerAddress | null;
  company: { name: string; number: string } | null;
};

/** Why a staff form or an import row is refused: a stable code; `field` names the address part that is missing. */
export type InputProblem =
  | { code: "email" }
  | { code: "phone" }
  | { code: "address"; field: "line1" | "postalCode" | "city" | "country" }
  | { code: "company_both" }
  | { code: "company_number" };

/** The parts of an address a form or a file gives, as typed. */
export type RawAddress = { line1?: unknown; line2?: unknown; postalCode?: unknown; city?: unknown; country?: unknown };

/**
 * An address from its parts: every part empty is no address (null), a partial one names the first missing part, the country is two letters
 * (ISO 3166-1, upper case). The name on it is the customer's.
 */
export function cleanAddressParts(raw: RawAddress, name: string): { ok: true; address: CustomerAddress | null } | { ok: false; field: "line1" | "postalCode" | "city" | "country" } {
  const line1 = oneLine(raw.line1, 200);
  const line2 = oneLine(raw.line2, 200);
  const postalCode = oneLine(raw.postalCode, 20);
  const city = oneLine(raw.city, 100);
  const country = oneLine(raw.country, 10).toUpperCase();
  if (!line1 && !line2 && !postalCode && !city && !country) return { ok: true, address: null };
  if (!line1) return { ok: false, field: "line1" };
  if (!postalCode) return { ok: false, field: "postalCode" };
  if (!city) return { ok: false, field: "city" };
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, field: "country" };
  return { ok: true, address: { name: oneLine(name, 120), line1, line2: line2 || null, postalCode, city, country } };
}

/** What a staff form sends, as typed. */
export type RawCustomerInput = RawAddress & { email?: unknown; name?: unknown; phone?: unknown; companyName?: unknown; organisationNumber?: unknown };

/**
 * A staff form's fields, cleaned and checked: the email is required and must be one, the phone a phone number, the address whole or empty,
 * and a company both a name and an organisation number or neither (the number checked by `checkNumber`, the country's own rule).
 */
export function cleanCustomerInput(
  raw: RawCustomerInput,
  checkNumber: (country: string | null, typed: string) => string | null,
  homeCountry: string | null,
): { ok: true; input: StaffCustomerInput } | { ok: false; problem: InputProblem } {
  const email = cleanEmail(raw.email);
  if (!email) return { ok: false, problem: { code: "email" } };
  const name = oneLine(raw.name, CUSTOMER_NAME_MAX);
  const phone = oneLine(raw.phone, CUSTOMER_PHONE_MAX + 1);
  if (!phoneOk(phone)) return { ok: false, problem: { code: "phone" } };
  const address = cleanAddressParts(raw, name);
  if (!address.ok) return { ok: false, problem: { code: "address", field: address.field } };
  const companyName = oneLine(raw.companyName, CUSTOMER_COMPANY_MAX);
  const typedNumber = oneLine(raw.organisationNumber, 40);
  let company: StaffCustomerInput["company"] = null;
  if (companyName || typedNumber) {
    if (!companyName || !typedNumber) return { ok: false, problem: { code: "company_both" } };
    const number = checkNumber(address.address?.country ?? homeCountry, typedNumber);
    if (!number) return { ok: false, problem: { code: "company_number" } };
    company = { name: companyName, number };
  }
  return { ok: true, input: { email, name, phone, address: address.address, company } };
}

/** Why two customers cannot be merged (`mergePlan()`), each a sentence in the catalogue. */
export const MERGE_REFUSALS = [
  "same",
  "not_found",
  "companies",
  "deliveries",
  "reviews",
  "gift_cards",
  "referrals",
  "bonus_pending",
  "addresses",
  "tags",
] as const;
export type MergeRefusal = (typeof MERGE_REFUSALS)[number];

/** What a merge moves to the customer kept, counted for the confirmation and the activity log. */
export type MergeCounts = {
  orders: number;
  subscriptions: number;
  wishlists: number;
  addresses: number;
  tags: number;
  notes: number;
  fields: number;
  bonusMinor: number;
};

/** The sentence for a refusal of a staff form or the merge, in the words given (the `customers` catalogue's `staff.problems`). */
export function staffProblemText(
  problem: InputProblem | { code: "taken" | "not_found" | "tags" | "addresses" | "forbidden" },
  words: { address: Record<"line1" | "postalCode" | "city" | "country", string> } & Record<Exclude<InputProblem["code"], "address"> | "taken" | "not_found" | "tags" | "addresses" | "forbidden", string>,
): string {
  return problem.code === "address" ? words.address[problem.field] : words[problem.code];
}

/** The fields a staff form sends (`CustomerForm`), read from its form data. */
export function customerFormFields(form: FormData): RawCustomerInput {
  const get = (name: string) => String(form.get(name) ?? "");
  return {
    email: get("email"),
    name: get("name"),
    phone: get("phone"),
    line1: get("line1"),
    line2: get("line2"),
    postalCode: get("postalCode"),
    city: get("city"),
    country: get("country"),
    companyName: get("companyName"),
    organisationNumber: get("organisationNumber"),
  };
}
