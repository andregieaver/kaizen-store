import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CanvaFieldProvider } from "@/components/admin/canva-field";
import { PageHeader } from "@/components/admin/ui";
import { SocialAdviser } from "@/components/admin/social-adviser";
import { SocialCalendar } from "@/components/admin/social-calendar";
import { SocialRulesCard } from "@/components/admin/social-rules-card";
import { RULE_POSTS_MAX } from "@/lib/social-rules";
import { SocialFacebookCard } from "@/components/admin/social-facebook-card";
import { SocialFactsCard } from "@/components/admin/social-facts-card";
import { SocialInsightsCard } from "@/components/admin/social-insights-card";
import { SocialPostCreator } from "@/components/admin/social-posts";
import { requireExtension } from "@/components/admin/extension-off";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { SOCIAL_WORDS } from "@/lib/admin-words/social";
import { areaTexts } from "@/lib/admin-area";
import { CANVA_FIELD_WORDS } from "@/lib/admin-words/canva-field";
import { todayIn } from "@/lib/analytics-period";
import { aiAbilities, aiFor } from "@/server/ai";
import { canvaForField } from "@/server/canva";
import { calendarOf } from "@/server/social-calendar";
import { publishTargets } from "@/server/social-publish";
import { socialRulesOf } from "@/server/social-rules";
import { facebookAppOn, facebookView } from "@/server/facebook-pages";
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
  searchParams,
}: PageProps<"/admin/[store]/social">) {
  const member = await requirePermission(
    (await params).store,
    "marketing:read",
  );
  // The social media manager is a paid extension (D870 S1.6): an account without it sees what it is and how to add it.
  const notInAccount = requireExtension(member, "social");
  if (notInAccount) return notInAccount;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = SOCIAL_WORDS[lang];
  const done = (await searchParams).facebook;
  const [products, pages, posts, insights, facebook, facts, advice, ai, abilities, canva] = await Promise.all([
    socialProducts(store),
    socialPages(store),
    listSocialPosts(store.id),
    houseOrStoreInsights(store),
    facebookView(store.id),
    gatherSocialFacts(store, member.account.id),
    latestAdvice(store.id),
    aiFor(store.id, { feature: "social_posts" }).catch(() => null),
    aiAbilities(store.id).catch(() => null),
    // A post's picture edited in the person's own Canva (D898 C3), for a member who may change the marketing.
    canvaForField(`/admin/${store.slug}/social/canva`, store.slug, "marketing:write"),
  ]);
  // The adviser's two-week plan with the drafts written for its days (S2.4).
  const [weeks, publishTo, rules] = await Promise.all([
    calendarOf(store.id, todayIn(new Date(), store.timeZone), advice?.advice.calendar ?? []),
    publishTargets(store),
    socialRulesOf(store.id),
  ]);
  const titles = Object.fromEntries([
    ...products.map((p) => [p.id, p.title]),
    ...[...facts.push, ...facts.newProducts, ...(advice ? [...advice.facts.push, ...advice.facts.newProducts] : [])].map((p) => [p.id, p.title]),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <SocialAdviser
        kept={advice ? { advice: advice.advice, main: mainRecommendation(advice.advice), createdAt: advice.createdAt } : null}
        titles={titles}
        base={`/admin/${store.slug}/social`}
        mayWrite={memberCan(member, "marketing:write")}
        hasAi={Boolean(ai?.textModel)}
        connectHref={insights.platform ? "/admin/platform/instagram" : `/admin/${store.slug}/integrations/instagram`}
        visitsHref={`/admin/${store.slug}/analytics/settings`}
        dateLocale={ADMIN_LANG_FACTS[lang].locale}
        timeZone={store.timeZone}
        words={w.adviser}
      />
      <SocialRulesCard rules={rules} mayChange={memberCan(member, "owner")} postsMax={RULE_POSTS_MAX} base={`/admin/${store.slug}/social`} words={w.rules} />
      <SocialCalendar
        weeks={weeks}
        titles={titles}
        base={`/admin/${store.slug}/social`}
        mayWrite={memberCan(member, "marketing:write")}
        hasAi={Boolean(ai?.textModel)}
        makesPictures={Boolean(abilities?.pictures)}
        publishTo={publishTo}
        timeZone={store.timeZone}
        dateLocale={ADMIN_LANG_FACTS[lang].locale}
        words={w.calendar}
      />
      <AdminTextScope texts={canva ? areaTexts(lang, { canvaField: CANVA_FIELD_WORDS }) : {}}>
        <CanvaFieldProvider canva={canva}>
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
        </CanvaFieldProvider>
      </AdminTextScope>
      <SocialInsightsCard
        view={insights.view}
        words={w.insights}
        connectHref={insights.platform ? "/admin/platform/instagram" : `/admin/${store.slug}/integrations/instagram`}
        mayConnect={memberCan(member, "settings:write")}
        numberLocale={ADMIN_LANG_FACTS[lang].locale}
        timeZone={store.timeZone}
      />
      <SocialFacebookCard
        view={facebook}
        words={w.facebook}
        action={`/admin/${store.slug}/social/facebook`}
        mayConnect={memberCan(member, "marketing:write")}
        appOn={facebookAppOn()}
        done={typeof done === "string" ? done : null}
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

