import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PageStudioView } from "@/components/admin/page-studio-view";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { studioAbilities } from "@/server/page-ai";
import { ownerLanguages } from "@/server/pages";
import { currentReplication } from "@/server/replicate";

import {
  storeStudioBuildAction,
  storeStudioHearAction,
  storeStudioPictureAction,
  storeStudioPlanAction,
  storeStudioSpeakAction,
  storeStudioTalkAction,
} from "./actions";

export const metadata: Metadata = { title: "Create a page with AI" };

/** Planning a page and writing its sections takes the site's AI a while (D92). */
export const maxDuration = 300;

export default async function StorePageStudio({ params }: PageProps<"/admin/[store]/pages/ai">) {
  const { store, account } = await requirePermission((await params).store, "website:read");
  const lang = adminLangOf(account.adminLocale);
  const [abilities, languages, replication] = await Promise.all([studioAbilities(store.id), ownerLanguages(store.id), currentReplication({ storeId: store.id })]);
  const locale = languages[0]?.locale ?? "en";
  const bind = <A extends unknown[], R>(action: (slug: string, ...args: A) => R) => action.bind(null, store.slug) as (...args: A) => R;
  return (
    <AdminTextScope texts={adminTexts(lang, ["website"])}>
    <PageStudioView
      actions={{
        talk: bind(storeStudioTalkAction),
        plan: bind(storeStudioPlanAction),
        build: bind(storeStudioBuildAction),
        picture: bind(storeStudioPictureAction),
        hear: abilities.hear ? bind(storeStudioHearAction) : null,
        speak: abilities.speak ? bind(storeStudioSpeakAction) : null,
      }}
      language={new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" }).of(locale) ?? locale}
      abilities={abilities}
      pagesHref={`/admin/${store.slug}/pages`}
      settingsHref={`/admin/${store.slug}/settings/ai`}
      replicate={{ storeSlug: store.slug, initial: replication }}
    />
    </AdminTextScope>
  );
}
