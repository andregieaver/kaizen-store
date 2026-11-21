import { z } from "zod";

import { COMPANY_NAME_MAX, TIER_NAME_MAX } from "./customer-tiers";

/**
 * The schemas of customer-tiers.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; customer-tiers.ts imports it as a type alone.
 */

const percent = (min: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v), z.number().int("Whole percent, please.").min(min).max(100));

export const tierInput = z.object({
  name: z.string().trim().min(1, "Give the group a name.").max(TIER_NAME_MAX),
  percent: percent(1),
  note: z.string().trim().max(300).default(""),
  active: z.boolean().default(true),
});
export type TierInput = z.input<typeof tierInput>;

export const companyInput = z.object({
  name: z.string().trim().min(1, "Give the company a name.").max(COMPANY_NAME_MAX),
  organisationNumber: z.string().trim().max(40).default(""),
  tierId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
  employeeSharePercent: percent(0).default(100),
  maxMembers: z.preprocess(
    (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
    z.number().int().min(1, "At least one account.").max(1000),
  ).default(25),
  active: z.boolean().default(true),
});
export type CompanyInput = z.input<typeof companyInput>;

/** The addresses typed into an invitation form: separated by commas, semicolons, spaces or lines, lower-cased, without repeats. */
export function parseInviteEmails(text: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!address) continue;
    if (!z.email().max(254).safeParse(address).success) invalid.push(part.trim());
    else if (!emails.includes(address)) emails.push(address);
  }
  return { emails, invalid };
}
