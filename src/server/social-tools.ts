import "server-only";

import type { Advice } from "@/lib/social-advice";
import type { SocialFacts } from "@/lib/social-facts";

import type { Account } from "./auth";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { OwnerToolError } from "./owner-tool-error";
import type { PermissionHolder } from "@/lib/permissions";
import { latestAdvice, writeSocialAdvice } from "./social-advice";
import { writeSocialPosts } from "./social-posts";
import { requestSocialPost } from "./social-queue";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { col, typedRows } from "./typed-rows";
import type { Store } from "./stores";

/**
 * The AI manager's social media tools (D870 S1.4b): `social_report` reads the adviser's newest answer with the figures it read,
 * `social_plan` asks the adviser anew, and `write_social_posts` writes posts with the creator. All work through the screens' own functions,
 * so the manager can never say a figure the facts do not hold. An Instagram caption never reaches the model through them: the facts are
 * given without captions, and the advice's words were checked when it was written (`parseAdvice()`). A plan may use `write_social_posts` as
 * a step, and it starts only on the owner's yes, as every autopilot plan.
 */

type Ctx = { account: Account; store: Store; invalidate: (tag: string) => void; holder?: PermissionHolder };

const memberOf = ({ account, store, holder }: Ctx) => ({ account, store, role: holder?.role ?? "owner", kind: holder?.kind, permissions: holder?.permissions });
const link = (store: Store) => `/admin/${store.slug}/social`;

/** The figures the manager may say, from the facts the advice was written from; no caption, no free text from outside. */
function figuresOf(facts: SocialFacts) {
  const ig = facts.instagram;
  // Advice kept before S1.2b has no Facebook facts.
  const fb = facts.facebook ?? { state: "none" as const };
  return {
    as_of: facts.asOf,
    currency: facts.store.currency,
    sales_last_28_days: { revenue_minor: facts.sales.revenueMinor, orders: facts.sales.orders, revenue_change: facts.sales.revenueChange, orders_change: facts.sales.ordersChange },
    from_social_media: facts.social
      ? { visits: facts.social.sessions, orders: facts.social.orders, revenue_minor: facts.social.revenueMinor, share_of_visits: facts.social.shareOfSessions, share_of_revenue: facts.social.shareOfRevenue }
      : "not known: the store does not count visits",
    products_worth_a_post: facts.push.map((p) => ({ id: p.id, title: p.title, margin: p.margin, sold: p.units, in_stock: p.stock })),
    new_products: facts.newProducts.map((p) => ({ id: p.id, title: p.title, in_stock: p.stock })),
    posts_written_last_90_days: facts.creator,
    instagram:
      ig.state === "ready"
        ? {
            username: ig.username,
            posts_last_90_days: ig.posts,
            posts_a_week: ig.postsPerWeek,
            days_since_last_post: ig.daysSinceLastPost,
            average_reach: { posts: ig.byKind.feed.averageReach, reels: ig.byKind.reel.averageReach, stories: ig.byKind.story.averageReach },
            saves_per_100_reached: ig.savesPer100Reach,
            best_weekday: ig.bestWeekday,
          }
        : ig.state === "none"
          ? "not connected"
          : ig.state === "reconnect"
            ? "connected without insights: the owner connects it again"
            : "connected; the first reading comes within a day",
    facebook:
      fb.state === "ready"
        ? {
            page: fb.name,
            posts_last_90_days: fb.posts,
            posts_a_week: fb.postsPerWeek,
            days_since_last_post: fb.daysSinceLastPost,
            average_reach: fb.averageReach,
            average_reactions_comments_and_shares: fb.averageInteractions,
            best_weekday: fb.bestWeekday,
          }
        : fb.state === "none"
          ? "not connected"
          : fb.state === "choose"
            ? "connected; the owner still chooses which Page is the shop's"
            : "connected; the first reading comes within a day",
  };
}

const adviceOf = (advice: Advice) => ({
  verdicts: advice.verdicts,
  recommendations: advice.recommendations.map((r) => ({ title: r.title, why: r.why, does: r.kind, product_id: r.productId, topic: r.topic || undefined, channels: r.channels })),
  planned_posts: advice.calendar.map((s) => ({ day: s.day, channel: s.channel, product_id: s.productId, idea: s.idea })),
});

/**
 * The approved posts not yet published (S3.1): their ids, channels and days, and their words' start, for publish_social_post, which puts one
 * on the posting queue (S3.2). The queue's job publishes it; the tools load no publishing, as the shop's functions load the tools (ci-red #66).
 */
async function readyToPost(storeId: string) {
  const rows = await typedRows(
    z.object({ id: col.uuid, channel: col.text, day: col.textOrNull, caption: col.text }),
    sql`select id, channel, planned_for::text as day, caption from commerce.social_posts
      where store_id = ${storeId}::uuid and approved_at is not null and published_at is null and channel in ('instagram', 'facebook')
      order by planned_for nulls last, created_at limit 10`,
  );
  return rows.map((r) => ({ post_id: r.id, channel: r.channel, planned_for: r.day, begins: r.caption.slice(0, 80) }));
}

export async function socialReportTool({ store }: Ctx) {
  const [kept, ready] = await Promise.all([latestAdvice(store.id), readyToPost(store.id)]);
  if (!kept) return { advice: null, ready_to_post: ready, say: "No advice is kept yet. Offer to ask the adviser (social_plan).", link: link(store) };
  return { written: kept.createdAt, ...adviceOf(kept.advice), figures: figuresOf(kept.facts), ready_to_post: ready, link: link(store) };
}

export async function socialPlanTool(ctx: Ctx) {
  const result = await writeSocialAdvice(memberOf(ctx));
  if (!result.ok) throw new OwnerToolError(result.problem);
  return { written: result.kept.createdAt, ...adviceOf(result.kept.advice), figures: figuresOf(result.kept.facts), link: link(ctx.store) };
}

export async function writeSocialPostsTool(ctx: Ctx, input: OwnerToolInput<"write_social_posts">) {
  const result = await writeSocialPosts(memberOf(ctx), { productId: input.product_id, topic: input.topic, channels: input.channels });
  if (!result.ok) throw new OwnerToolError(result.problem);
  return {
    done: `Written for ${result.posts.map((p) => p.channel).join(", ")}, kept on the Social posts page to copy into each channel. Nothing is posted.`,
    link: link(ctx.store),
  };
}

/** Puts an approved post on the posting queue for now (S3.2), once the owner said yes: the dispatcher publishes it within minutes. */
export async function publishSocialPostTool(ctx: Ctx, input: OwnerToolInput<"publish_social_post">) {
  const result = await requestSocialPost(memberOf(ctx), input.post_id);
  if (!result.ok) throw new OwnerToolError(result.problem);
  return { done: "Queued: it goes out within a few minutes, and Social posts shows it as posted with its link.", link: link(ctx.store) };
}
