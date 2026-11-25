import type { Metadata } from "next";

import { PageHeader } from "@/components/admin/ui";
import { SocialAdviser } from "@/components/admin/social-adviser";
import { SocialFactsCard } from "@/components/admin/social-facts-card";
import { SocialInsightsCard } from "@/components/admin/social-insights-card";
import { SocialPostCreator } from "@/components/admin/social-posts";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { SOCIAL_WORDS } from "@/lib/admin-words/social";
import { aiFor } from "@/server/ai";
import { memberCan, requirePermission } from "@/server/permissions";
import { mainRecommendation } from "@/lib/social-advice";
import { latestAdvice } from "@/server/social-advice";
import { gatherSocialFacts } from "@/server/social-facts";
import { insightsView } from "@/server/social-insights";
import {
  listSocialPosts,
  socialPages,
  socialProducts,
} from "@/server/social-posts";

export const metadata: Metadata = { title: "Social posts" };

/**
 * The social post creator (D870 C1, `docs/social-manager.md` 3): Homer picks a product and presses Write posts, and gets a post per channel
 * to copy; Lisa's theme and the price line are under Customise. The store's posts are below, newest first.
 */
export default async function SocialPostsPage({
  params,
}: PageProps<"/admin/[store]/social">) {
  const member = await requirePermission(
    (await params).store,
    "marketing:read",
  );
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = SOCIAL_WORDS[lang];
  const [products, pages, posts, insights, facts, advice, ai] = await Promise.all([
    socialProducts(store),
    socialPages(store),
    listSocialPosts(store.id),
    houseOrStoreInsights(store),
    gatherSocialFacts(store, member.account.id),
    latestAdvice(store.id),
    aiFor(store.id, { feature: "social_posts" }).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <SocialAdviser
        kept={advice ? { advice: advice.advice, main: mainRecommendation(advice.advice), createdAt: advice.createdAt } : null}
        titles={Object.fromEntries([...facts.push, ...facts.newProducts, ...(advice ? [...advice.facts.push, ...advice.facts.newProducts] : [])].map((p) => [p.id, p.title]))}
        base={`/admin/${store.slug}/social`}
        mayWrite={memberCan(member, "marketing:write")}
        hasAi={Boolean(ai?.textModel)}
        connectHref={insights.platform ? "/admin/platform/instagram" : `/admin/${store.slug}/integrations/instagram`}
        visitsHref={`/admin/${store.slug}/analytics/settings`}
        dateLocale={ADMIN_LANG_FACTS[lang].locale}
        timeZone={store.timeZone}
        words={w.adviser}
      />
      <SocialPostCreator
        products={products}
        pages={pages}
        posts={posts}
        mayWrite={memberCan(member, "marketing:write")}
        hasAi={Boolean(ai?.textModel)}
        timeZone={store.timeZone}
        dateLocale={ADMIN_LANG_FACTS[lang].locale}
        base={`/admin/${store.slug}/social`}
        words={w}
      />
      <SocialInsightsCard
        view={insights.view}
        words={w.insights}
        connectHref={insights.platform ? "/admin/platform/instagram" : `/admin/${store.slug}/integrations/instagram`}
        mayConnect={memberCan(member, "settings:write")}
        numberLocale={ADMIN_LANG_FACTS[lang].locale}
        timeZone={store.timeZone}
      />
      <SocialFactsCard facts={facts} words={w.facts} locale={ADMIN_LANG_FACTS[lang].locale} />
    </div>
  );
}

/**
 * The account whose figures the page shows: the store's own Instagram; for Kaizena Flow's own store (C1b), Kaizena Flow's account on
 * Platform, Instagram while the store has none of its own.
 */
async function houseOrStoreInsights(store: { id: string; house?: boolean }) {
  const own = await insightsView(store.id);
  if (own.state !== "none" || !store.house) return { view: own, platform: false };
  return { view: await insightsView(null), platform: true };
}

