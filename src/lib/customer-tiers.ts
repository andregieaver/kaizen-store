import { planPrice } from "./subscriptions";

export type { CompanyInput, TierInput } from "./customer-tiers-schema";

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
