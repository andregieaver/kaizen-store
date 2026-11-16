import Link from "next/link";
import { connection } from "next/server";

import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagePlaceForm } from "@/components/admin/page-place-form";
import { PageJobsPanel } from "@/components/admin/page-jobs-panel";
import { PagesTable } from "@/components/admin/pages-table";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { LAYOUT_TYPES, type PageType } from "@/lib/page-content";
import { isThemeStoreRole, PLATFORM_ROLE_COPY, SPECIAL_ROLES, type PlatformRole } from "@/lib/platform-roles";
import { requirePlatformReader } from "@/server/auth";
import { listPages } from "@/server/pages";
import { runningPageJobs } from "@/server/page-jobs";
import { getPlatformPageRoles } from "@/server/platform-roles";
import { siteLayoutChoice } from "@/server/site-layouts";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { PlatformLegalCard, platformLegalLead } from "@/components/admin/platform-legal-card";
import { adminLangOf } from "@/lib/admin-lang";
import { platformLegalOverview } from "@/server/platform-legal";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";

import {
  choosePlatformSiteLayoutAction,
  createPlatformRolePageAction,
  setPlatformPageRoleAction,
  stopPlatformPageJobAction,
} from "./actions";
import { duplicatePageAction } from "./duplicate-action";
import { writeLegalPagesAction } from "./legal-action";

import { typeWords } from "./type-words";

/**
 * Kaizen's pages (D42) and blog articles (D57): the same list, editor,
 * preview and categories, at `/admin/platform/pages` and `/articles`.
 */

type Query = Promise<Record<string, string | string[] | undefined>>;


export async function PagesListView({ type, searchParams }: { type: PageType; searchParams: Query }) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformReader();
  const { lang, w } = await platformSiteWords();
  const tw = typeWords(w, type);
  const copy = PAGE_TYPE_COPY[type];
  const base = `/admin/platform/${copy.segment}`;
  const [all, query, roles, legal] = await Promise.all([
    listPages(null, type),
    searchParams,
    type === "page" ? getPlatformPageRoles() : [],
    type === "page" ? platformLegalOverview() : null,
  ]);
  // The theme store's own pages (D285) are edited from Themes, so they are not mixed with these.
  const themeStorePages = new Set(roles.flatMap(([role, id]) => (isThemeStoreRole(role) ? [id] : [])));
  const pages = all.filter((p) => !themeStorePages.has(p.id));
  // Pages that have a place of their own (D143) are not offered for another.
  const placedIds = new Set(roles.map(([, id]) => id));
  const roleOf = Object.fromEntries(roles.map(([role, id]) => [role, id]));
  const offered = (role: PlatformRole) => pages.filter((p) => (!placedIds.has(p.id) || p.id === roleOf[role]) && (p.state !== "draft" || p.id === roleOf[role]));
  return (
    <AdminTextScope texts={adminTexts(lang, ["website", "platformSite"])}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title={<>{tw.list}</>}
          meta={[
            legal &&
              fillWords(w.pages.leadJoin, {
                pages: pages.length === 0 ? w.pages.leadNoPages : countWords(pages.length, w.pages.leadPages),
                legal: platformLegalLead(legal, adminText(lang, "platformLegal")),
              }),
          ]}
          description={<>{tw.intro}</>}
        />
        <div className="flex flex-wrap gap-3">
          {!LAYOUT_TYPES.includes(type) && (
            <Link href={`${base}/categories`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.categories}
            </Link>
          )}
          {type === "page" && pages.length > 0 && (
            <Link href={`${base}/ai`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.createAi}
            </Link>
          )}
          {!(type === "page" && pages.length === 0) && (
            <Link href={`${base}/new`} className="flex min-h-11 items-center rounded-pill bg-brand px-5 font-medium text-brand-ink">
              {tw.new}
            </Link>
          )}
        </div>
      </div>

      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {tw.deleted}
        </p>
      )}

      {/* The AI's page work on Kaizena Flow's own site still going (PSI UX-01), with a Stop. */}
      {(type === "page" || type === "article") && (
        <PageJobsPanel jobs={await runningPageJobs(null)} pagesBase="/admin/platform/pages" articlesBase="/admin/platform/articles" stop={stopPlatformPageJobAction} />
      )}

      {pages.length === 0 && type === "page" ? (
        <section aria-labelledby="first-page" className={`flex flex-wrap items-center justify-between gap-4 p-6 ${CARD_CLASS}`}>
          <span className="flex max-w-xl flex-col gap-1">
            <h2 id="first-page" className="text-title text-ink">
              {w.pages.firstPage}
            </h2>
            <span className="text-caption text-ink-2">{w.pages.firstPageSub}</span>
          </span>
          <span className="flex flex-wrap gap-3">
            <Link href={`${base}/ai`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.createAi}
            </Link>
            <Link href={`${base}/new`} className="flex min-h-11 items-center rounded-pill bg-brand px-5 font-medium text-brand-ink">
              {tw.new}
            </Link>
          </span>
        </section>
      ) : pages.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.none}
        </p>
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={(await siteLayoutChoice(null))[type]} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={copy.sitePrefix}
          placed={Object.fromEntries(roles.map(([role, id]) => [id, { name: w.tables.roles[role].name, address: PLATFORM_ROLE_COPY[role].address }]))}
          duplicate={duplicatePageAction.bind(null, type)}
        />
      )}
      {legal && <PlatformLegalCard lang={adminLangOf(admin.adminLocale)} overview={legal} write={writeLegalPagesAction} />}
      {type === "page" && (
        <section className="flex flex-col gap-4" aria-labelledby="special-pages">
          <div className="flex flex-col gap-1">
            <h2 id="special-pages" className="text-title text-ink">
              {w.pages.special}
            </h2>
            <p className="max-w-2xl text-sm text-muted">{w.pages.specialNote}</p>
          </div>
          <ul className={`divide-y divide-line px-6 ${CARD_CLASS}`}>
          {SPECIAL_ROLES.map((role) => (
            <PagePlaceForm
              key={role}
              name={w.tables.roles[role].name}
              hint={w.tables.roles[role].hint}
              standard={w.tables.roles[role].standard}
              current={roleOf[role] ?? null}
              pages={offered(role)}
              choose={setPlatformPageRoleAction.bind(null, role) as never}
              start={createPlatformRolePageAction.bind(null, role) as never}
            />
          ))}
          </ul>
        </section>
      )}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={(await siteLayoutChoice(null))[type]}
          siteName={w.pages.siteName}
          action={choosePlatformSiteLayoutAction.bind(null, type)}
        />
      )}
    </AdminTextScope>
  );
}
