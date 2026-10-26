import "server-only";

import { autonomyDecision, CUSTOMER_EMAIL_TOOLS, discountDepth, type AutonomyDecision, type AutonomySettings } from "@/lib/autopilot-autonomy";
import type { MakeThemeLiveInput } from "@/lib/design-tools";
import type { GateCategory } from "@/lib/owner-tools";
import type { SetPricesInput } from "@/lib/product-tools";

import type { Account } from "./auth";
import { autopilotCustomerEmailsThisWeek } from "./autopilot-settings";
import { liveCostsMoney } from "./design-tools";
import { priceChangePercent } from "./product-tools";
import type { Store } from "./stores";

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
  const facts =
    tool === "set_prices" && p.store
      ? { priceChangePercent: await priceChangePercent(p.store, p.account, args as SetPricesInput) }
      : tool === "create_discount" || tool === "create_campaign"
        ? { discountPercent: discountDepth(tool, args) }
        : tool === "make_theme_live" && p.store
          ? { costsMoney: await liveCostsMoney(p.store, p.account, args as MakeThemeLiveInput) }
          : (CUSTOMER_EMAIL_TOOLS as readonly string[]).includes(tool)
            ? { customerEmailsThisWeek: p.store ? await autopilotCustomerEmailsThisWeek(p.store.id) : null }
            : {};
  return autonomyDecision(settings, tool, gate, facts);
}
