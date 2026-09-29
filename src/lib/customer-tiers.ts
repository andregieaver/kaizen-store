import { z } from "zod";

import { planPrice } from "./subscriptions";

/**
 * Discount groups and company accounts (D108): the pure rules. A store puts
 * customers in a tier (a fixed percentage off), and a company's members get
 * its tier's discount, employees at the share the store set. What the
 * discount comes to on a basket is worked out here, and checkout and the
 * cart both use it, so they cannot disagree.
 */

export const TIER_NAME_MAX = 80;
export const COMPANY_NAME_MAX = 120;

/** How long an invitation can be accepted, in days. */
export const INVITE_DAYS = 14;
/** Invitations one company can send in a day. */
export const INVITES_PER_DAY = 50;
/** Addresses in one go. */
export const INVITES_PER_BATCH = 20;

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

/** What a customer's own group gives, and what their company's group does, as read from the store's data. */
export type MemberSources = {
  own: { name: string; percent: number } | null;
  company: { name: string; active: boolean; tier: { percent: number } | null; sharePercent: number; role: "owner" | "employee" } | null;
};

export type MemberDiscount = {
  /** The percentage off, to two decimals: an employee gets the company's share of the tier's. */
  percent: number;
  /** Who it is from, as the shopper reads it: their group's name, or their company's. */
  label: string;
  via: "tier" | "company";
};

/** A company's members' percentage: the main account gets the whole of the tier's, an employee its share of it. */
export function companyPercent(tierPercent: number, sharePercent: number, role: "owner" | "employee"): number {
  return role === "owner" ? tierPercent : Math.round(tierPercent * sharePercent) / 100;
}

/** The discount a customer gets: the better of their own group's and their company's, or none. */
export function memberDiscount({ own, company }: MemberSources): MemberDiscount | null {
  const fromCompany =
    company && company.active && company.tier ? { percent: companyPercent(company.tier.percent, company.sharePercent, company.role), label: company.name, via: "company" as const } : null;
  const fromOwn = own ? { percent: own.percent, label: own.name, via: "tier" as const } : null;
  const best = fromCompany && fromOwn ? (fromOwn.percent >= fromCompany.percent ? fromOwn : fromCompany) : (fromOwn ?? fromCompany);
  return best && best.percent > 0 ? best : null;
}

/** What the discount takes off a line bought once: the lowered unit price, as a subscription's is, times the quantity. */
export function memberLineOff(unitMinor: number, quantity: number, discountPercent: number): number {
  return (unitMinor - planPrice(unitMinor, discountPercent)) * quantity;
}

/** "10" or "7.5": a percentage without trailing zeros. */
export function percentText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** An order's discount split into the campaigns', the group's and the code's, for showing them as lines. */
export function discountParts(order: {
  discountMinor: number;
  memberDiscountMinor: number;
  memberLabel: string | null;
  memberPercent: number | null;
  discountCode: string | null;
  campaignDiscountMinor: number;
  campaignLabel: string | null;
}) {
  const campaign = Math.min(order.campaignDiscountMinor, order.discountMinor);
  const member = Math.min(order.memberDiscountMinor, order.discountMinor - campaign);
  return {
    campaignMinor: campaign,
    campaignLabel: order.campaignLabel,
    memberMinor: member,
    memberLabel: order.memberLabel,
    memberPercent: order.memberPercent,
    codeMinor: order.discountMinor - campaign - member,
    code: order.discountCode,
  };
}

/** What a discount row says it is from: the campaigns, the group or company and its percent, and the code: "Summer sale, Acme AS 10 %, SUMMER". */
export function discountNote(order: Parameters<typeof discountParts>[0]): string | null {
  const parts = discountParts(order);
  const from = [
    parts.campaignMinor > 0 ? parts.campaignLabel : null,
    parts.memberMinor > 0 && parts.memberLabel ? `${parts.memberLabel}${parts.memberPercent ? ` ${percentText(parts.memberPercent)} %` : ""}` : null,
    parts.codeMinor > 0 || (!parts.memberMinor && !parts.campaignMinor && parts.code) ? parts.code : null,
  ].filter(Boolean);
  return from.length > 0 ? from.join(", ") : null;
}

export type InviteStatus = "pending" | "accepted" | "revoked" | "ended";

/** Why an invitation cannot be accepted, if it cannot. */
export type InviteProblem = "gone" | "expired" | "company_off" | "full" | "other_company";
