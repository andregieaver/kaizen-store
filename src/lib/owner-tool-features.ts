/**
 * The store features (D178, `src/lib/store-features.ts`) the AI manager's store tools stand behind: a tool here is offered only while its
 * feature is on, in the assistant (`runTurn()`), and refused by `runOwnerTool()`/`preflightOwnerTool()` and the store's MCP server, so a
 * feature switched off takes its tools with it. A tool not listed is the shop's or the site's own and is always offered. A test holds that every
 * name here is a tool.
 */
import type { OwnerToolName } from "./owner-tools";
import { requirementLabel, requirementMet, type FeatureRequirement, type FeatureSource } from "./store-features";

const BOOKED: FeatureRequirement = ["appointments", "bookings"];

export const TOOL_FEATURES: Partial<Record<OwnerToolName, FeatureRequirement>> = {
  list_subscriptions: "subscriptions",
  subscription_boxes: "boxes",
  list_bookings: BOOKED,
  cancel_booking: BOOKED,
  get_bonus_program: "bonus",
  set_bonus_program: "bonus",
  adjust_customer_credits: "bonus",
  get_affiliate_program: "referrals",
  set_affiliate_program: "referrals",
  block_affiliate: "referrals",
};

/** The feature a tool stands behind, or undefined. */
export const toolFeature = (name: string): FeatureRequirement | undefined => (Object.hasOwn(TOOL_FEATURES, name) ? TOOL_FEATURES[name as OwnerToolName] : undefined);

/** Whether the store offers a tool: no feature, or its feature is on. */
export const toolOffered = (store: FeatureSource, name: string): boolean => requirementMet(store, toolFeature(name));

/** What the assistant says of a tool whose feature is off. */
export function toolFeatureRefusal(name: string): string {
  const feature = toolFeature(name);
  return `${feature ? requirementLabel(feature) : "That feature"} is switched off in this store. An owner switches it on under Settings → Features.`;
}
