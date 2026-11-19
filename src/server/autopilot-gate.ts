import "server-only";

import { autonomyDecision, CUSTOMER_EMAIL_TOOLS, discountDepth, type AutonomyDecision, type AutonomySettings } from "@/lib/autopilot-autonomy";
import type { MakeThemeLiveInput } from "@/lib/design-tools";
import type { GateCategory } from "@/lib/owner-tools";
import type { SetPricesInput } from "@/lib/product-tools";

import { adBudgetAutopilotProblem } from "./ad-budget-tools";
import type { Account } from "./auth";
import { autopilotBroadcastsThisWeek, autopilotCustomerEmailsThisWeek, autopilotSupportRepliesToday } from "./autopilot-settings";
import { liveCostsMoney } from "./design-tools";
import { OwnerToolError } from "./owner-tool-error";
import { marginAfterOffer, marginAfterPrices, priceChangePercent } from "./product-tools";
import { exchangeRefundOf } from "./exchange-tools";
import { priceRuleAutopilotFacts } from "./market-price-tools";
import { orderChangeMoneyOf, type OrderChangeInput } from "./order-change-tools";
import type { Store } from "./stores";
import { replacementAutopilotProblem } from "./replacement-tools";
import { purchaseAutopilotProblem } from "./supply-tools";

/** A purchase order against the purchasing budget (C3): one that cannot be made at all asks too, with the reason in words. */
async function purchaseProblemOf(store: Store, args: Record<string, unknown>, settings: AutonomySettings): Promise<string | null> {
  try {
    return await purchaseAutopilotProblem(store, args, settings.budgets);
  } catch (error) {
    if (error instanceof OwnerToolError) return error.message;
    throw error;
  }
}

/**
 * The autopilot's decision for one gated call (D309, `docs/ai-autopilot.md` 7.4): the facts the owner's budgets need read first (a price
 * change's size from the product as the editor reads it, a discount's depth from its arguments, the emails to customers it sent this week),
 * then `autonomyDecision()`. Used by the loop's tool steps and inside its task turns alike.
 */
export async function autopilotDecision(
  p: { account: Account; store: Store | null },
  settings: AutonomySettings,
  tool: string,
  gate: GateCategory,
  args: Record<string, unknown>,
): Promise<AutonomyDecision> {
  // Challenge mode's own budgets (`docs/100-day-challenge.md` 4A2): a broadcast a week, answers on the support desk a day.
  if (settings.challenge && p.store && (tool === "send_broadcast" || tool === "reply_to_support")) {
    const facts =
      tool === "send_broadcast" ? { broadcastsThisWeek: await autopilotBroadcastsThisWeek(p.store.id) } : { supportRepliesToday: await autopilotSupportRepliesToday(p.store.id) };
    return autonomyDecision(settings, tool, gate, facts);
  }
  // A confirmed exchange in challenge mode (B3, D675): processed by itself only when it gives nothing back to the customer.
  if (settings.challenge && p.store && tool === "process_exchange") {
    return autonomyDecision(settings, tool, gate, { exchangeRefundMinor: await exchangeRefundOf(p.store, String(args.return ?? "")) });
  }
  // A lost parcel's replacement in challenge mode (B3, D679): sent by itself only within the cap on its goods' value.
  if (settings.challenge && p.store && tool === "send_replacement") {
    return autonomyDecision(settings, tool, gate, { replacementProblem: await replacementAutopilotProblem(p.store, String(args.order ?? ""), settings.challenge.replacementMax) });
  }
  // A change to a paid order in challenge mode (A2, D804): by itself only when it moves no money.
  if (settings.challenge && p.store && tool === "change_order") {
    return autonomyDecision(settings, tool, gate, { orderChangeMoney: await orderChangeMoneyOf({ account: p.account, store: p.store }, args as OrderChangeInput) });
  }
  // A country's price rule in challenge mode (A2, D804): by itself within the largest price change and the margin floor.
  if (settings.challenge && p.store && tool === "set_market_price_rule") {
    return autonomyDecision(settings, tool, gate, await priceRuleAutopilotFacts(p.store, args));
  }
  // The margin floor (D5) is read only where the owner, or the challenge, set one: it costs a read of the catalogue.
  const floor = settings.budgets.marginFloorPercent !== null;
  const depth = tool === "create_discount" || tool === "create_campaign" ? discountDepth(tool, args) : null;
  const facts =
    tool === "set_prices" && p.store
      ? {
          priceChangePercent: await priceChangePercent(p.store, p.account, args as SetPricesInput),
          ...(floor ? { lowestMarginPercent: await marginAfterPrices(p.store, p.account, args as SetPricesInput) } : {}),
        }
      : tool === "create_discount" || tool === "create_campaign"
        ? {
            discountPercent: depth,
            ...(depth === 0 ? { marginUntouched: true } : floor && depth !== null && p.store ? { lowestMarginPercent: await marginAfterOffer(p.store, depth) } : {}),
          }
        : tool === "make_theme_live" && p.store
          ? { costsMoney: await liveCostsMoney(p.store, p.account, args as MakeThemeLiveInput) }
          : tool === "set_ad_budget" && p.store
            ? { adProblem: await adBudgetAutopilotProblem(p.store, args, settings.budgets.adRaisePercent) }
            : tool === "create_purchase_order" && p.store
            ? { purchaseProblem: await purchaseProblemOf(p.store, args, settings) }
            : (CUSTOMER_EMAIL_TOOLS as readonly string[]).includes(tool)
            ? { customerEmailsThisWeek: p.store ? await autopilotCustomerEmailsThisWeek(p.store.id) : null }
            : {};
  return autonomyDecision(settings, tool, gate, facts);
}
