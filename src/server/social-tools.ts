import "server-only";

import type { Advice } from "@/lib/social-advice";
import type { SocialFacts } from "@/lib/social-facts";

import type { Account } from "./auth";
import type { OwnerToolInput } from "@/lib/owner-tools";
import { OwnerToolError } from "./owner-tool-error";
import type { PermissionHolder } from "@/lib/permissions";
import { latestAdvice, writeSocialAdvice } from "./social-advice";
import { writeSocialPosts } from "./social-posts";
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
  };
}

const adviceOf = (advice: Advice) => ({
  verdicts: advice.verdicts,
  recommendations: advice.recommendations.map((r) => ({ title: r.title, why: r.why, does: r.kind, product_id: r.productId, topic: r.topic || undefined, channels: r.channels })),
  planned_posts: advice.calendar.map((s) => ({ day: s.day, channel: s.channel, product_id: s.productId, idea: s.idea })),
});

export async function socialReportTool({ store }: Ctx) {
  const kept = await latestAdvice(store.id);
  if (!kept) return { advice: null, say: "No advice is kept yet. Offer to ask the adviser (social_plan).", link: link(store) };
  return { written: kept.createdAt, ...adviceOf(kept.advice), figures: figuresOf(kept.facts), link: link(store) };
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
