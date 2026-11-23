/**
 * Tagged links for social posts and what each post sold (D870 S1.1, `docs/social-manager.md` 3, `docs/analytics.md` "Post"). A post's
 * link is the store's own address with `utm_source` (the channel), `utm_medium=social`, `utm_campaign` (the plan's theme, or `social`)
 * and `utm_content` (which post: `p-` and the post's reference, or `bio` for the profile's link). The visit keeps the content
 * (`visits.content`), so `postReport()` can follow a post to its visits, carts, orders and profit. Pure.
 */

import type { Channel } from "./analytics-channels";
import { campaignLink } from "./analytics-campaigns";
import { cleanCampaign, cleanContent } from "./analytics-traffic";

/** The channels the social media manager posts to, in the order they arrive (D870). Each is a `utm_source` the classifier knows as social. */
export const POST_CHANNELS = ["instagram", "facebook", "pinterest", "tiktok", "linkedin"] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];

/** The campaign of a post link with no theme. */
export const DEFAULT_POST_CAMPAIGN = "social";
/** The content of the link in a channel's profile (the bio), which is no post. */
export const BIO_CONTENT = "bio";

/** A post's reference: 6 to 24 lower-case letters and digits (a post's id as the manager keeps it, never a person). */
const POST_REF = /^[a-z0-9]{6,24}$/;

/** The `utm_content` for a post (`p-` and its reference), or null for a reference of another shape. */
export function postContent(ref: string): string | null {
  return POST_REF.test(ref) ? `p-${ref}` : null;
}

export type PostLinkInput = {
  /** A page of the store's own, such as a product's address. */
  address: string;
  channel: PostChannel;
  /** The post's reference (`postContent()`), or `bio` for the profile's link. */
  post: string;
  /** The plan's theme; `social` when empty. */
  campaign?: string;
};

/**
 * The address to put in a post: the store's page with the four tags, and the channel the visit will count in (organic social). Null when
 * the address is not the store's own (`ownOrigins`), the channel is not one of `POST_CHANNELS` or the post's reference is malformed.
 */
export function postLink(input: PostLinkInput, ownOrigins: readonly string[]): { url: string; channel: Channel; content: string } | null {
  if (!POST_CHANNELS.includes(input.channel)) return null;
  const content = input.post === BIO_CONTENT ? BIO_CONTENT : postContent(input.post);
  if (!content) return null;
  const campaign = cleanCampaign(input.campaign ?? "") || DEFAULT_POST_CAMPAIGN;
  const link = campaignLink({ address: input.address, source: input.channel, medium: "social", campaign }, ownOrigins);
  if (!link) return null;
  const url = new URL(link.url);
  url.searchParams.set("utm_content", content);
  return { url: url.toString(), channel: link.channel, content: cleanContent(content) };
}

/** What `postReport()` reads per post: money in the store's main currency without VAT, minor units. */
export type PostInput = {
  source: string;
  campaign: string;
  content: string;
  /** Visitor-days that landed from the post. */
  sessions: number;
  /** Of those, visitor-days that made a cart. */
  carts: number;
  /** Paid orders placed from those visits' carts. */
  orders: number;
  revenueMinor: number;
  /** Cost of the goods sold, over the lines whose cost is known. */
  cogsMinor: number;
  /** Line revenue (without VAT) of the orders, and the part of it whose cost is known. */
  lineRevenueMinor: number;
  knownLineRevenueMinor: number;
};

export type PostRow = PostInput & {
  /** Orders per session; null without sessions. */
  conversion: number | null;
  /** Share of line revenue whose cost is known, 0 to 1; null without line revenue. */
  costCoverage: number | null;
  /**
   * What the goods left after their cost: line revenue less cost of goods, only when every line's cost is known (a partial figure would
   * flatter the post); 0 for a post with no orders; null while a cost is missing.
   */
  grossProfitMinor: number | null;
};

export function postRows(inputs: readonly PostInput[]): PostRow[] {
  return inputs.map((r) => {
    const costCoverage = r.lineRevenueMinor > 0 ? Math.min(1, r.knownLineRevenueMinor / r.lineRevenueMinor) : null;
    const grossProfitMinor = r.orders === 0 ? 0 : costCoverage === 1 ? r.lineRevenueMinor - r.cogsMinor : null;
    return { ...r, conversion: r.sessions > 0 ? r.orders / r.sessions : null, costCoverage, grossProfitMinor };
  });
}
