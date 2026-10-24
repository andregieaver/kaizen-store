/**
 * Campaigns on the Marketing page (wave 5 unit I3, D303, `docs/analytics.md` "Campaign"): CAC and ROAS per campaign by the channel table's
 * definitions, shown only where spend was entered, and the campaign-link builder, which makes a store's own address with the tags and says
 * which channel the visit will be sorted into. Pure.
 */

import type { Channel } from "./analytics-channels";
import { classifyChannel, cleanCampaign, cleanSource } from "./analytics-traffic";

export type CampaignInput = { source: string; campaign: string; sessions: number; orders: number; revenueMinor: number; newCustomers: number; spendMinor: number };

export type CampaignRow = CampaignInput & {
  /** Orders per session, null without sessions. */
  conversion: number | null;
  /** Spend per new customer, null without spend or new customers. */
  cacMinor: number | null;
  /** Revenue per unit of spend, null without spend. */
  roas: number | null;
};

export function campaignRows(inputs: readonly CampaignInput[]): CampaignRow[] {
  return inputs.map((r) => ({
    ...r,
    conversion: r.sessions > 0 ? r.orders / r.sessions : null,
    cacMinor: r.spendMinor > 0 && r.newCustomers > 0 ? Math.round(r.spendMinor / r.newCustomers) : null,
    roas: r.spendMinor > 0 ? Math.round((r.revenueMinor / r.spendMinor) * 100) / 100 : null,
  }));
}

/** The mediums the builder offers, each named by the channel a visit with it is sorted into. */
export const LINK_MEDIUMS = ["cpc", "paid_social", "email", "social", "affiliate", "referral"] as const;
export type LinkMedium = (typeof LINK_MEDIUMS)[number];

export type CampaignLinkInput = { address: string; source: string; medium: LinkMedium; campaign: string };

/**
 * A store page's address with the tags (`utm_source`, `utm_medium`, `utm_campaign`) and the channel the visit will count in, or null when
 * the address is not the store's own (`ownOrigins`) or a tag is empty after tidying. Existing query parameters are kept.
 */
export function campaignLink(input: CampaignLinkInput, ownOrigins: readonly string[]): { url: string; channel: Channel } | null {
  let url: URL;
  try {
    url = new URL(input.address.trim());
  } catch {
    return null;
  }
  if (!ownOrigins.includes(url.origin)) return null;
  const source = cleanSource(input.source);
  const campaign = cleanCampaign(input.campaign);
  if (!source || !campaign || !LINK_MEDIUMS.includes(input.medium)) return null;
  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", input.medium);
  url.searchParams.set("utm_campaign", campaign);
  const { channel } = classifyChannel({ ownHosts: ownOrigins.map((o) => new URL(o).host), utmSource: source, utmMedium: input.medium, utmCampaign: campaign });
  return { url: url.toString(), channel };
}
