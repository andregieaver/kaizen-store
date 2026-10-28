import "server-only";

import type { db } from "@/db/client";
import { campaignsThatGave, codeRuleFor, codesWin, type CodeRule, type CombinationSaving } from "@/lib/discount-combinations";
import type { DiscountLine } from "@/lib/discounts";
import type { Market } from "@/lib/markets";

import { evaluateCampaigns, type BasketLine, type CampaignOutcome } from "./campaigns";
import { stackForBasket, type CodesResult } from "./discounts";

type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * What the caller counts once campaigns took `lineOff` (by the campaign lines' keys) and `shippingMinor` off: the basket the codes
 * are checked against, and what the group's discount (D108) and the friend's welcome discount (D131) take off between them. The
 * caller's own arithmetic, the same it uses for the codes afterwards, so the choice is made on what the shopper would pay.
 */
export type AfterCampaigns = (
  lineOff: Readonly<Record<string, number>>,
  shippingMinor: number,
) => { codes: { lines: DiscountLine[]; shippingMinor: number }; otherMinor: number };

export type CampaignsAndCodes = {
  /** The campaigns the basket takes: all of them, or only those that combine with the codes that won. */
  outcome: CampaignOutcome;
  /** Which codes these campaigns let in: passed to the codes' `stackForBasket()`, which refuses the rest as `with_campaigns`. */
  codeRule: CodeRule;
  /** Campaigns that would have given the basket something but gave way to a code that gives more, for the cart to say. */
  leftOut: { campaignId: string; name: string }[];
};

const NO_CAMPAIGNS: CampaignOutcome = {
  result: { lineOff: {}, lineBy: {}, lineParts: {}, applied: [], gifts: [], valueMinor: 0, freeShipping: null, next: [] },
  gifts: [],
  weighed: [],
};

/**
 * The campaigns and codes a basket takes together (D367), decided once for `cartSummary()` and `placeOrder()` alike. Campaigns come
 * first and codes count what they leave (D114), as far as they combine: a campaign's `combinesWithCodes` and a code's
 * `combinesWithCampaigns`, both on by default. When a code on the cart is kept out by the campaigns, the two ways are weighed:
 * (a) every campaign, with the codes they let in, or (b) the codes, with only the campaigns that combine with them (none when a code
 * used does not combine with campaigns). The basket takes the one that saves the shopper more, counting the lines, a free product's
 * worth and shipping made free, the codes and what the group's and welcome discounts then take; a tie keeps the campaigns. The
 * alternatives are only evaluated when there is such a conflict, so a basket without one costs one evaluation as before.
 */
export async function campaignsAndCodes(
  runner: Runner,
  shop: { storeId: string; market: Market },
  lines: BasketLine[],
  context: { ships: boolean; customerId: string | null; lock?: boolean },
  codes: readonly string[],
  /** What a campaign's free shipping is worth to this basket: its first shipping, or 0 where it cannot have it (a subscription, nothing to ship). */
  freeShippingMinor: number,
  after: AfterCampaigns,
): Promise<CampaignsAndCodes> {
  const all = await evaluateCampaigns(runner, shop, lines, context);
  const gave = (outcome: CampaignOutcome) => {
    const ids = campaignsThatGave(outcome.result, outcome.gifts, freeShippingMinor > 0);
    return outcome.weighed.filter((c) => ids.includes(c.id));
  };
  const ruleAll = codeRuleFor(gave(all));
  const keepAll: CampaignsAndCodes = { outcome: all, codeRule: ruleAll, leftOut: [] };
  if (codes.length === 0 || ruleAll === "any") return keepAll;

  const shippingOff = (outcome: CampaignOutcome) => (outcome.result.freeShipping ? freeShippingMinor : 0);
  const stack = async (outcome: CampaignOutcome, rule: CodeRule) => {
    const counted = after(outcome.result.lineOff, shippingOff(outcome));
    const result = await stackForBasket(
      runner,
      shop.storeId,
      [...codes],
      { market: shop.market, customerId: context.customerId, lock: context.lock, campaigns: rule },
      { marketCode: shop.market.code, ...counted.codes },
    );
    return { result, otherMinor: counted.otherMinor };
  };
  const saving = (outcome: CampaignOutcome, codesWith: { result: CodesResult; otherMinor: number }): CombinationSaving => ({
    campaignsMinor:
      Object.values(outcome.result.lineOff).reduce((sum, off) => sum + off, 0) +
      outcome.gifts.reduce((sum, gift) => sum + gift.unitPriceMinor * gift.quantity, 0) +
      shippingOff(outcome),
    codesMinor: codesWith.result.applied?.totalMinor ?? 0,
    otherMinor: codesWith.otherMinor,
  });

  // (a) Every campaign, with the codes they let in. No code kept out by them: nothing to weigh.
  const kept = await stack(all, ruleAll);
  if (!kept.result.codes.some((c) => !c.ok && c.problem === "with_campaigns")) return keepAll;

  // (b) The codes as they would be used with no campaign: with them only the campaigns that combine with codes, or none at all
  // when a code used does not combine with campaigns.
  const bare = await stack(NO_CAMPAIGNS, "any");
  if (bare.result.used.length === 0) return keepAll;
  let outcome = NO_CAMPAIGNS;
  let rule: CodeRule = "any";
  let codesWith = bare;
  if (bare.result.used.every((u) => u.discount.combinesWithCampaigns)) {
    const leaveOut = new Set(all.weighed.filter((c) => !c.combinesWithCodes).map((c) => c.id));
    // Every campaign combines with codes: (b) would be (a) again.
    if (leaveOut.size === 0) return keepAll;
    outcome = await evaluateCampaigns(runner, shop, lines, { ...context, leaveOut });
    rule = codeRuleFor(gave(outcome));
    if (rule !== "any") codesWith = await stack(outcome, rule);
  }
  const codesKept = { ...saving(outcome, codesWith), codesUsed: codesWith.result.used.length };
  if (!codesWin(saving(all, kept), codesKept)) return keepAll;
  const still = new Set(gave(outcome).map((c) => c.id));
  return {
    outcome,
    codeRule: rule,
    leftOut: gave(all)
      .filter((c) => !still.has(c.id))
      .map((c) => ({ campaignId: c.id, name: c.name })),
  };
}
