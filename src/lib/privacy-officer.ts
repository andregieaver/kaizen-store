/**
 * The data protection officer (D763): who an account names for all its stores, and who a store names instead. Pure: the choices a form
 * sends, read into one shape, and the officer as a store's texts name them. The server (`src/server/privacy-officers.ts`) keeps the rows.
 */

import { z } from "zod";

/** What the owner chose: nobody yet (an account), its account's (a store), a person on the team, or someone outside. */
export type OfficerChoice =
  | { kind: "none" }
  | { kind: "account" }
  | { kind: "staff"; accountId: string }
  | { kind: "person"; name: string; email: string; phone: string | null; firm: string | null };

/** An officer as texts name them. `staff`: a person on the team, read from their account. */
export type Officer = { name: string | null; email: string; phone: string | null; firm: string | null; staff: boolean };

/** Where a store's officer comes from: its own choice, its account's, or none at all. */
export type ResolvedOfficer = { source: "store" | "account" | "none"; officer: Officer | null };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v));

const PERSON = z.object({
  name: z.string().trim().min(1, "Write the officer's name.").max(200, "Keep the name under 200 characters."),
  email: z.string().trim().max(254).regex(EMAIL, "Write the officer's email address."),
  phone: optional(40),
  firm: optional(200),
});

/**
 * A form's fields read into a choice: `officer` is `none`, `account` (a store only), `staff:{accountId}` or `person` with `name`, `email`,
 * `phone` and `firm`. Problems are words for the owner.
 */
export function readOfficerChoice(fields: Record<string, string | undefined>, { store }: { store: boolean }): { ok: true; choice: OfficerChoice } | { ok: false; problems: string[] } {
  const officer = (fields.officer ?? "").trim();
  if (officer === "none" && !store) return { ok: true, choice: { kind: "none" } };
  if (officer === "account" && store) return { ok: true, choice: { kind: "account" } };
  const staff = /^staff:([0-9a-f-]{36})$/i.exec(officer);
  if (staff) return { ok: true, choice: { kind: "staff", accountId: staff[1].toLowerCase() } };
  if (officer === "person") {
    const parsed = PERSON.safeParse({ name: fields.name ?? "", email: fields.email ?? "", phone: fields.phone ?? "", firm: fields.firm ?? "" });
    if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
    return { ok: true, choice: { kind: "person", ...parsed.data } };
  }
  return { ok: false, problems: ["Choose who the data protection officer is."] };
}

/** The officer in one line, as the owner's screens summarise it: name, firm and address. */
export function officerSummary(officer: Officer): string {
  return [officer.name, officer.firm, officer.email].filter((part): part is string => Boolean(part)).join(", ");
}

/** The officer's fields of a submitted form, as `readOfficerChoice()` reads them. */
export function officerFields(form: FormData): Record<string, string | undefined> {
  return Object.fromEntries(
    ["officer", "name", "email", "phone", "firm"].map((key) => {
      const value = form.get(key);
      return [key, typeof value === "string" ? value : undefined];
    }),
  );
}
