/**
 * Campaigns and discount codes on one basket (D367): an owner says whether a campaign combines with codes
 * (`campaigns.combines_with_codes`) and whether a code combines with campaigns (`discount_codes.combines_with_campaigns`),
 * both on by default, as they always combined before. Where they do not, the basket takes whichever gives the shopper the
 * larger saving: the campaigns without the code, or the code with only the campaigns that combine with it; a tie keeps the
 * campaigns. The rules here need no database; `campaignsAndCodes()` (`src/server/discount-combinations.ts`) weighs the two for
 * `cartSummary()` and `placeOrder()` alike.
 */

/**
 * Which codes a basket's campaigns let in: `any` (no campaign gives the basket anything), `combining` (only codes that combine
 * with campaigns) or `none` (a campaign that gives something does not combine with codes).
 */
export type CodeRule = "any" | "combining" | "none";

/** The rule the campaigns that gave a basket something set for its codes. */
export function codeRuleFor(applied: readonly { combinesWithCodes: boolean }[]): CodeRule {
  if (applied.length === 0) return "any";
  return applied.every((c) => c.combinesWithCodes) ? "combining" : "none";
}

/** Whether a code may be used under the campaigns' rule. */
export function codeAllowed(rule: CodeRule | null | undefined, discount: { combinesWithCampaigns: boolean }): boolean {
  if (!rule || rule === "any") return true;
  return rule === "combining" && discount.combinesWithCampaigns;
}

/** What one way of reducing a basket saves the shopper, in minor units: what the campaigns, the codes and the rest take off. */
export type CombinationSaving = {
  /** Off the lines, the free products' worth and the shipping a campaign made free. */
  campaignsMinor: number;
  /** What the codes take off, shipping included. */
  codesMinor: number;
  /** What the group's discount and the welcome discount take off after these campaigns (they keep their place, D108, D131). */
  otherMinor: number;
};

export const savingOf = (s: CombinationSaving) => s.campaignsMinor + s.codesMinor + s.otherMinor;

/**
 * Whether the codes win over the campaigns they do not combine with: only when they save the shopper strictly more and a code is
 * used at all; a tie keeps the campaigns, which the shopper did not have to type.
 */
export function codesWin(campaignsKept: CombinationSaving, codesKept: CombinationSaving & { codesUsed: number }): boolean {
  return codesKept.codesUsed > 0 && savingOf(codesKept) > savingOf(campaignsKept);
}

/** The campaigns that gave a basket something: a reduction on a line, a free product it gets, or its shipping made free. */
export function campaignsThatGave(
  result: {
    applied: readonly { campaignId: string }[];
    freeShipping: { campaignId: string } | null;
  },
  gifts: readonly { campaignId: string }[],
  freeShippingCounts: boolean,
): string[] {
  return [
    ...new Set([
      ...result.applied.map((a) => a.campaignId),
      ...gifts.map((g) => g.campaignId),
      ...(freeShippingCounts && result.freeShipping ? [result.freeShipping.campaignId] : []),
    ]),
  ];
}
