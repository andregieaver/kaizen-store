import Link from "next/link";
import { connection } from "next/server";

import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagePlaceForm } from "@/components/admin/page-place-form";
import { PageJobsPanel } from "@/components/admin/page-jobs-panel";
import { ListPager } from "@/components/admin/list-pager";
import { PagesTable } from "@/components/admin/pages-table";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { LAYOUT_TYPES, type PageType } from "@/lib/page-content";
import { isThemeStoreRole, PLATFORM_ROLE_COPY, SPECIAL_ROLES, type PlatformRole } from "@/lib/platform-roles";
import { requirePlatformReader } from "@/server/auth";
import { countPages, listPages, pageTitles } from "@/server/pages";
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
import { setPlatformOfficerAction, writeLegalPagesAction } from "./legal-action";
import { PrivacyOfficerForm } from "@/components/admin/privacy-officer-form";
import { accountOfficer, officerCandidates, platformAccountId, storedChoice } from "@/server/privacy-officers";

import { typeWords } from "./type-words";

/**
 * Kaizen's pages (D42) and blog articles (D57): the same list, editor,
 * preview and categories, at `/admin/platform/pages` and `/articles`.
 */

type Query = Promise<Record<string, string | string[] | undefined>>;

/** How many pages a list shows at a time (bloat review step 2.17), with the count and a pager as a store's Pages list has. */
const PAGE_SIZE = 100;


export async function PagesListView({ type, searchParams }: { type: PageType; searchParams: Query }) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const admin = await requirePlatformReader();
  const { lang, w } = await platformSiteWords();
  const tw = typeWords(w, type);
  const copy = PAGE_TYPE_COPY[type];
  const base = `/admin/platform/${copy.segment}`;
  const query = await searchParams;
  const page = Math.max(1, Math.floor(Number(typeof query.page === "string" ? query.page : "1")) || 1);
  // Every read of the list at once: the hundred shown and their count, every page by title for the places' choices, and what is beside.
  const [all, total, every, roles, legal, platform, jobs, layoutChoice] = await Promise.all([
    listPages(null, type, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countPages(null, type),
    type === "page" ? pageTitles(null, type) : Promise.resolve([]),
    type === "page" ? getPlatformPageRoles() : Promise.resolve([]),
    type === "page" ? platformLegalOverview() : Promise.resolve(null),
    // Kaizena Flow's own data protection officer (D763), beside its legal pages: the platform account's.
    type === "page" ? platformAccountId() : Promise.resolve(null),
    type === "page" || type === "article" ? runningPageJobs(null) : Promise.resolve([]),
    type === "header" || type === "footer" ? siteLayoutChoice(null) : Promise.resolve(null),
  ]);
  const layoutCurrent = layoutChoice && (type === "header" || type === "footer") ? layoutChoice[type] : null;
  const pagerWords = adminText(lang, "website").storePages;
  const officer = legal && platform
    ? await Promise.all([storedChoice(platform, null), officerCandidates(platform, null), accountOfficer(platform)]).then(([choice, people, current]) => ({ choice, people, current }))
    : null;
  const pw = adminText(adminLangOf(admin.adminLocale), "privacyOfficer");
  // The theme store's own pages (D285) are edited from Themes, so they are not mixed with these.
  const themeStorePages = new Set(roles.flatMap(([role, id]) => (isThemeStoreRole(role) ? [id] : [])));
  const pages = all.filter((p) => !themeStorePages.has(p.id));
  // Pages that have a place of their own (D143) are not offered for another.
  const placedIds = new Set(roles.map(([, id]) => id));
  const roleOf = Object.fromEntries(roles.map(([role, id]) => [role, id]));
  // Every page of the kind is offered, not only the hundred shown: a draft only where it is chosen already.
  const choices = every.filter((p) => !themeStorePages.has(p.id)).map((p) => ({ id: p.id, title: p.title, state: p.live ? "published" : "draft" }));
  // How many pages there are (the lead and the first page's card): every one of the kind, not only the hundred shown.
  const count = type === "page" ? choices.length : total;
  const offered = (role: PlatformRole) => choices.filter((p) => (!placedIds.has(p.id) || p.id === roleOf[role]) && (p.state !== "draft" || p.id === roleOf[role]));
  return (
    <AdminTextScope texts={adminTexts(lang, ["website", "platformSite"])}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title={<>{tw.list}</>}
          meta={[
            legal &&
              fillWords(w.pages.leadJoin, {
                pages: count === 0 ? w.pages.leadNoPages : countWords(count, w.pages.leadPages),
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
          {type === "page" && count > 0 && (
            <Link href={`${base}/ai`} className="flex min-h-11 items-center rounded-pill border border-edge px-5 font-medium">
              {w.pages.createAi}
            </Link>
          )}
          {!(type === "page" && count === 0) && (
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
        <PageJobsPanel jobs={jobs} pagesBase="/admin/platform/pages" articlesBase="/admin/platform/articles" stop={stopPlatformPageJobAction} />
      )}

      {count === 0 && type === "page" ? (
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
        <SiteLayoutsTable layouts={pages} adminBase={base} current={layoutCurrent} />
      ) : (
        <PagesTable
          timeZone={PLATFORM_TIME_ZONE}
          pages={pages}
          adminBase={base}
          siteBase={copy.sitePrefix}
          placed={Object.fromEntries(roles.map(([role, id]) => [id, { name: w.tables.roles[role].name, address: PLATFORM_ROLE_COPY[role].address }]))}
          duplicate={duplicatePageAction.bind(null, type)}
        />
      )}
      {total > all.length && <ListPager words={pagerWords} label={tw.list} base={base} query={query} page={page} size={PAGE_SIZE} shown={all.length} total={total} />}
      {legal && <PlatformLegalCard lang={adminLangOf(admin.adminLocale)} overview={legal} write={writeLegalPagesAction} />}
      {officer && (
        <section className="flex max-w-xl flex-col gap-3" aria-labelledby="platform-officer" id="privacy-officer">
          <h2 id="platform-officer" className="text-title text-ink">
            {pw.title}
          </h2>
          <p className="text-sm text-muted">{pw.platformLead}</p>
          <PrivacyOfficerForm words={pw} action={setPlatformOfficerAction} store={false} choice={officer.choice} people={officer.people} current={officer.current} />
        </section>
      )}
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
          current={layoutCurrent}
          siteName={w.pages.siteName}
          action={choosePlatformSiteLayoutAction.bind(null, type)}
        />
      )}
    </AdminTextScope>
  );
}
