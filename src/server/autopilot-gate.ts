import "server-only";

import { autonomyDecision, discountDepth, type AutonomyDecision, type AutonomySettings } from "@/lib/autopilot-autonomy";
import type { GateCategory } from "@/lib/owner-tools";
import type { SetPricesInput } from "@/lib/product-tools";

import type { Account } from "./auth";
import { priceChangePercent } from "./product-tools";
import type { Store } from "./stores";

/**
 * The autopilot's decision for one gated call (D309, `docs/ai-autopilot.md` 7.4): the facts the owner's budgets need read first (a price
 * change's size from the product as the editor reads it, a discount's depth from its arguments), then `autonomyDecision()`. Used by the
 * loop's tool steps and inside its task turns alike.
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
        : {};
  return autonomyDecision(settings, tool, gate, facts);
}
