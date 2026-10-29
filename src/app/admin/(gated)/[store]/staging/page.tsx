import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { SiteStaging, type StagingActions, type StagingView } from "@/components/admin/site-staging";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { lastStaging, stagingOverview } from "@/server/site-staging";

import {
  discardStagingAction,
  dropStagedMenuAction,
  keepStagedCopyAction,
  publishStagingAction,
  stagePageAction,
  stageThemeAction,
  startStagingAction,
} from "./actions";

export const metadata: Metadata = { title: "Staging" };

/** Website → Staging (D358): page drafts, a theme and menu changes gathered, compared and made live together. */
export default async function StagingPage({ params }: PageProps<"/admin/[store]/staging">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "website").staging;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const [overview, last] = await Promise.all([stagingOverview(store.id), lastStaging(store.id)]);
  const base = `/admin/${store.slug}`;
  const view: StagingView = {
    open: overview.staging ? { name: overview.staging.name, since: when(overview.staging.createdAt), installId: overview.staging.installId } : null,
    pages: overview.pages.map((p) => ({
      id: p.id,
      title: p.title,
      type: p.type,
      isNew: p.isNew,
      staged: p.staged,
      differences: p.differences,
      // A copy is edited in the builder's staging mode (D385), the page's own draft untouched.
      editHref: `${base}/${PAGE_TYPE_COPY[p.type]?.segment ?? "pages"}/${p.id}${p.copy ? "?staging=1" : ""}`,
      copy: p.copy,
      liveChanged: p.liveChanged,
    })),
    themes: overview.themes,
    menus: overview.menus.map((m) => ({ ...m, stageHref: `${base}/menus?menu=${m.id}&staged=1` })),
    last: last ? { name: last.name, status: last.status, when: last.at ? when(last.at) : null, outcome: last.outcome } : null,
  };
  const slug = store.slug;
  const actions: StagingActions = {
    start: startStagingAction.bind(null, slug),
    stagePage: stagePageAction.bind(null, slug),
    keepCopy: keepStagedCopyAction.bind(null, slug),
    stageTheme: stageThemeAction.bind(null, slug),
    dropMenu: dropStagedMenuAction.bind(null, slug),
    discard: discardStagingAction.bind(null, slug),
    publish: publishStagingAction.bind(null, slug),
  };
  return (
    <AdminTextScope texts={adminTexts(lang, ["website", "builder", "schedules"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        <SiteStaging view={view} canWrite={memberCan(member, "website:write")} actions={actions} />
      </div>
    </AdminTextScope>
  );
}
