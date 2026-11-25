import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PageHeader } from "@/components/admin/ui";
import { SocialPostCreator } from "@/components/admin/social-posts";
import { areaTexts } from "@/lib/admin-area";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { aiFor } from "@/server/ai";
import { memberCan, requirePermission } from "@/server/permissions";
import { listSocialPosts, socialProducts } from "@/server/social-posts";

import { socialPostCopiedAction, writeSocialPostsAction } from "./actions";

export const metadata: Metadata = { title: "Social posts" };

/**
 * The social post creator (D870 C1, `docs/social-manager.md` 3): Homer picks a product and presses Write posts, and gets a post per channel
 * to copy; Lisa's theme and the price line are under Customise. The store's posts are below, newest first.
 */
export default async function SocialPostsPage({ params }: PageProps<"/admin/[store]/social">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = MARKETING_WORDS[lang].social;
  const [products, posts, ai] = await Promise.all([socialProducts(store), listSocialPosts(store.id), aiFor(store.id, { feature: "social_posts" }).catch(() => null)]);

  return (
    <AdminTextScope texts={areaTexts(lang, { marketing: MARKETING_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        <SocialPostCreator
          products={products}
          posts={posts}
          mayWrite={memberCan(member, "marketing:write")}
          hasAi={Boolean(ai?.textModel)}
          timeZone={store.timeZone}
          dateLocale={ADMIN_LANG_FACTS[lang].locale}
          write={writeSocialPostsAction.bind(null, store.slug)}
          copied={socialPostCopiedAction.bind(null, store.slug)}
        />
      </div>
    </AdminTextScope>
  );
}
