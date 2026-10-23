import { z } from "zod";

/**
 * Who a domain is registered to (D315 decision 1, `docs/domains.md` 4.5): the store's owner or their company, never Kaizena Flow. Filled in
 * from the store's business details and the owner's account; the owner confirms. Shared by the form and the server.
 */

/** A phone number as registrars want it (E.164): `+` and the country's code, spaces and dashes taken out. */
export function e164(phone: string, country: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  const code = COUNTRY_CODES[country.toUpperCase()];
  return code ? `+${code}${digits.replace(/^0+/, "")}` : digits;
}

/** The calling codes of the countries stores sell from first; others type a `+`. */
const COUNTRY_CODES: Record<string, string> = { NO: "47", SE: "46", DK: "45", FI: "358", IS: "354", DE: "49", NL: "31", GB: "44", FR: "33", ES: "34", IT: "39", PL: "48" };

const text = (max: number, what: string) => z.string().trim().min(1, `Fill in ${what}.`).max(max, `${what[0].toUpperCase()}${what.slice(1)} is too long.`);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const registrantInput = z
  .object({
    kind: z.enum(["person", "company"]),
    firstName: text(100, "the first name"),
    lastName: text(100, "the last name"),
    companyName: optional(200),
    orgNumber: optional(40),
    email: z.string().trim().email("Write a working email address: the registry sends a confirmation there.").max(254),
    phone: z.string().trim().min(4, "Fill in a phone number.").max(30),
    address1: text(200, "the street address"),
    address2: optional(200),
    city: text(100, "the town or city"),
    state: z.string().trim().max(100).default(""),
    postalCode: text(20, "the postal code"),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "Choose a country."),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "company" && !v.companyName) ctx.addIssue({ code: "custom", path: ["companyName"], message: "Fill in the company's name." });
  })
  .transform((v) => ({ ...v, phone: e164(v.phone, v.country) }))
  .refine((v) => /^\+\d{6,15}$/.test(v.phone), { path: ["phone"], message: "Write the phone number with its country code, like +47 22 33 44 55." });

export type RegistrantInput = z.output<typeof registrantInput>;

/** The registrar's fields from ours. */
export function registrarContact(r: RegistrantInput) {
  return {
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    address1: r.address1,
    ...(r.address2 ? { address2: r.address2 } : {}),
    city: r.city,
    // Registrars want a state or region; countries without one repeat the city.
    state: r.state || r.city,
    zip: r.postalCode,
    country: r.country,
    ...(r.kind === "company" && r.companyName ? { companyName: r.companyName } : {}),
  };
}

/** The registrant as a form starts with it (`suggestedRegistrant()`). */
export type RegistrantPrefill = {
  kind: "person" | "company";
  firstName: string;
  lastName: string;
  companyName: string;
  orgNumber: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postalCode: string;
  country: string;
};

/** Terms a domain may be bought for at once. */
export const DOMAIN_YEARS = [1, 2, 3, 5] as const;
