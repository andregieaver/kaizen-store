import Link from "next/link";
import type { ReactNode } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DemoHomePages } from "@/components/admin/demo-home-pages";
import { AdminTextScope } from "@/components/admin/admin-text";
import { PageJobsPanel } from "@/components/admin/page-jobs-panel";
import { PageCards } from "@/components/admin/page-cards";
import { PhoneRow } from "@/components/admin/phone-row";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { ListPager } from "@/components/admin/list-pager";
import { PagesTable } from "@/components/admin/pages-table";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { fillWords, countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { WebsiteMessages } from "@/lib/admin-messages/website.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LAYOUT_TYPES, type PageType } from "@/lib/page-content";
import { ROLE_COPY, ROLE_GROUPS, partOfRole, type PageRole } from "@/lib/page-roles";
import { featureOn, requirementMet } from "@/lib/store-features";
import { shopPartFeature } from "@/lib/store-parts";
import type { Term } from "@/lib/taxonomy";
import { latestHomeTake, homePageOffers } from "@/server/home-takes";
import { memberCan, requirePageTypeAccess } from "@/server/permissions";
import { countPages, listPages, pageTitles, type PageSummary } from "@/server/pages";
import { runningPageJobs } from "@/server/page-jobs";
import { scheduleChips } from "@/server/page-schedules";
import { isScheduledType } from "@/lib/page-schedules";
import { layoutUses, type LayoutUse } from "@/server/product-layouts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { listTerms } from "@/server/taxonomy";
import { buttonClass, Card, CARD_CLASS, Chip, CountBadge, PageHeader } from "@/components/admin/ui";
import { commentCounts } from "@/server/blog-comments";

import {
  chooseStoreSiteLayoutAction,
  createRolePageAction,
  setFrontPageAction,
  setPageRoleAction,
  setProductsPageAction,
  stopPageJobAction,
} from "./actions";
import { storePageContext, storePagesBase } from "./context";
import { undoDemoHomeAction, useDemoHomeAction } from "./home-actions";


/**
 * A store's pages (D53) and blog articles (D57): the same list, editor,
 * preview and categories as Kaizen's, at `/admin/{store}/pages` and `/articles`.
 */

type StoreParams = Promise<{ store: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

/** The words of a store's page lists (`website.storePages`) and of the lists they share (`website.list`). */
type ListWords = WebsiteMessages["storePages"];
type SharedWords = WebsiteMessages["list"];

/** How many pages a list shows at a time (bloat review step 2.17), with the count and a pager as the Stores list has. */
const PAGE_SIZE = 100;

export async function StorePagesListView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams: Query }) {
  const gated = await requirePageTypeAccess((await params).store, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store } = gated;
  const query = await searchParams;
  const page = Math.max(1, Math.floor(Number(typeof query.page === "string" ? query.page : "1")) || 1);
  const lang = adminLangOf(gated.account.adminLocale);
  // What is scheduled for each page, article, header or footer, and what did not happen (D340), on the store's clock.
  const clock = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const writes = memberCan(gated, "website:write");
  // Every read of the list at once: the hundred shown and their count; every page of the kind by title for what the list says of all of
  // them (how many are live, the newest, the front page) and the own-page choices; and what each kind of list draws beside.
  const [pages, total, every, context, comments, schedules, jobs, uses, terms, layoutChoice, offers, take] = await Promise.all([
    listPages(store.id, type, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    countPages(store.id, type),
    type === "page" || type === "article" ? pageTitles(store.id, type) : Promise.resolve([]),
    storePageContext(store, type),
    type === "article" ? commentCounts(store.id) : Promise.resolve(null),
    isScheduledType(type) ? scheduleChips(store.id, type, adminText(lang, "schedules").chips, (iso) => clock.format(new Date(iso))) : Promise.resolve({}),
    type === "page" || type === "article" ? runningPageJobs(store.id) : Promise.resolve([]),
    type === "product_layout" ? layoutUses(store.id) : Promise.resolve(new Map<string, LayoutUse>()),
    type === "product_layout" ? listTerms({ storeId: store.id, contentType: "product" }) : Promise.resolve([]),
    type === "header" || type === "footer" ? siteLayoutChoice(store.id) : Promise.resolve(null),
    type === "page" && writes ? homePageOffers() : Promise.resolve([]),
    type === "page" && writes ? latestHomeTake(store.id) : Promise.resolve(null),
  ]);
  const base = storePagesBase(store, type);
  // Pages that have a place of their own (D112) are not offered for another.
  const roleIds = new Set(Object.values(store.pageRoles));
  const blogWords = adminText(lang, "blog");
  const site = adminText(lang, "website");
  const w = site.storePages;
  const tw = w.types[type];
  const waitingComments = comments?.pending ?? 0;
  // The page list's sentence (D615): how many pages are live, and which one the shop opens on.
  // A working page of a store feature that is off (D178) is not offered; one already chosen stays, so it can be changed.
  const ownRoles = ROLE_GROUPS.flatMap((group) => group.roles).filter((role) => roleOffered(store, role));
  const ownCount = ownRoles.filter((role) => store.pageRoles[role]).length + (store.productsPageId ? 1 : 0);
  // The own-page choices offer every page of the kind, not only the hundred shown: a draft is offered only where it is chosen already.
  const choices = every.map((p) => ({ id: p.id, title: p.title, state: p.live ? "published" : "draft" }));
  const titleOf = (id: string | null) => (id ? (every.find((p) => p.id === id)?.title || site.list.untitled) : null);
  const live = every.filter((p) => p.live).length;
  const newest = type === "article"
    ? every.filter((p) => p.live && p.publishedAt).sort((a, b) => b.publishedAt!.localeCompare(a.publishedAt!))[0]
    : undefined;
  const frontPage = type === "page" ? every.find((p) => p.id === store.frontPageId && p.live) : undefined;
  const current = layoutChoice && (type === "header" || type === "footer") ? layoutChoice[type] : null;
  return (
    <AdminTextScope texts={adminTexts(adminLangOf(gated.account.adminLocale), ["website", "schedules"])}>
    <div className="flex flex-col gap-6">
      {type === "page" ? (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader
            title={tw.list}
            meta={[
              <span key="live">
                <span className="text-ink">{live === 0 ? w.cards.noneLive : countWords(live, w.cards.live)}</span>
                {frontPage ? fillWords(w.cards.opensOn, { page: frontPage.title || site.list.untitled }) : w.cards.opensOnProducts}
              </span>,
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <MoreMenu label={w.cards.more}>
              <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium hover:bg-sunken">
                {w.categories}
              </Link>
            </MoreMenu>
            <Link href={`${base}/ai`} className="inline-flex h-11 items-center rounded-pill border border-edge bg-card px-4 text-body text-ink hover:bg-sunken">
              {w.createAi}
            </Link>
            <Link href={`${base}/new`} className="inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              {tw.new}
            </Link>
          </div>
        </div>
      ) : type === "article" ? (
        // The blog drawn for Homer (round 9, D630): a sentence, New article, and categories, blogs and comments under More.
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader
            title={tw.list}
            meta={[
              <span key="live">
                <span className="text-ink">{live === 0 ? blogWords.list.noneLive : countWords(live, blogWords.list.live)}</span>
                {newest
                  ? fillWords(blogWords.list.newest, {
                      title: newest.title || site.list.untitled,
                      date: new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { day: "numeric", month: "long", timeZone: store.timeZone }).format(
                        new Date(newest.publishedAt!),
                      ),
                    })
                  : total === 0 && blogWords.list.firstSoon}
              </span>,
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <MoreMenu label={blogWords.list.more}>
              <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium hover:bg-sunken">
                {w.categories}
              </Link>
              <Link href={`${base}/blogs`} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium hover:bg-sunken">
                {blogWords.links.blogs}
              </Link>
              <Link href={`${base}/comments`} className="inline-flex min-h-10 items-center gap-2 rounded-pill px-4 text-sm font-medium hover:bg-sunken">
                {blogWords.links.comments}
                {waitingComments > 0 && <CountBadge count={waitingComments} />}
              </Link>
            </MoreMenu>
            <Link href={`${base}/new`} className="inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              {tw.new}
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <PageHeader title={tw.list} description={tw.intro} />
          <div className="flex flex-wrap gap-2">
            {!LAYOUT_TYPES.includes(type) && (
              <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
                {w.categories}
              </Link>
            )}
            <Link
              href={`${base}/new`}
              className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
            >
              {tw.new}
            </Link>
          </div>
        </div>
      )}
      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {tw.deleted}
        </p>
      )}
      {/* The AI's page work still going (PSI UX-01): builds and pictures, with a Stop for who may change the site. */}
      {(type === "page" || type === "article") && (
        <PageJobsPanel
          jobs={jobs}
          pagesBase={storePagesBase(store, "page")}
          articlesBase={storePagesBase(store, "article")}
          stop={memberCan(gated, "website:write") ? stopPageJobAction.bind(null, store.slug) : undefined}
        />
      )}
      {type === "page" ? (
        <PageCards
          pages={pages}
          adminBase={base}
          siteBase={context.siteBase}
          frontPageId={store.frontPageId}
          productsPageId={store.productsPageId}
          roles={Object.fromEntries(Object.entries(store.pageRoles).map(([role, id]) => [id, role as PageRole]))}
          schedules={schedules}
          duplicate={context.actions.duplicate}
        />
      ) : type === "article" ? (
        <>
          {waitingComments > 0 && (
            <p className={`flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-body text-ink ${CARD_CLASS}`}>
              {countWords(waitingComments, blogWords.list.waiting)}
              <Link href={`${base}/comments`} className="text-sm font-medium text-ink underline underline-offset-2">
                {blogWords.list.read}
              </Link>
            </p>
          )}
          <PageCards
            pages={pages}
            adminBase={base}
            siteBase={context.siteBase}
            schedules={schedules}
            duplicate={context.actions.duplicate}
            label={blogWords.list.label}
            newLabel={tw.new}
            newSub={blogWords.list.newSub}
          />
        </>
      ) : pages.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.none}
        </p>
      ) : type === "product_layout" ? (
        <ProductLayoutsTable
          layouts={pages}
          adminBase={base}
          uses={uses}
          terms={terms}
          words={w.layouts}
          shared={site.list}
          locale={ADMIN_LANG_FACTS[lang].locale}
        />
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={current} schedules={schedules} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={context.siteBase}
          schedules={schedules}
          duplicate={context.actions.duplicate}
        />
      )}
      {total > pages.length && <ListPager words={w} label={tw.list} base={base} query={query} page={page} size={PAGE_SIZE} shown={pages.length} total={total} />}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={current}
          siteName={w.siteName}
          action={chooseStoreSiteLayoutAction.bind(null, store.slug, type)}
        />
      )}
      {/* A demo store's home page as the front page, and the store's own put back (docs/theme-showcase-phase-1.md step 4c). */}
      {type === "page" && writes && (
        <DemoHomePages
          offers={offers}
          take={take}
          editBase={base}
          use={useDemoHomeAction.bind(null, store.slug)}
          undo={undoDemoHomeAction.bind(null, store.slug)}
        />
      )}
      {/* The shop's own pages (D112, D113; D615): one row each, its page or Standard, and Change opening a small window with the choice. */}
      {/* Round 33 (D707): on a phone the shop's own pages are one row saying how many are your own; from the small breakpoint up as before. */}
      {type === "page" && (
        <div className="max-sm:overflow-hidden max-sm:rounded-panel">
        <PhoneRow
          flat
          last
          title={w.cards.own}
          sub={ownCount === 0 ? w.cards.phone.allStandard : fillWords(w.cards.phone.ownSub, { own: ownCount, standard: ownRoles.length + (featureOn(store, "shop") ? 1 : 0) - ownCount })}
          change={w.cards.change}
          done={w.cards.close}
        >
        <section aria-labelledby="special-pages" className={`flex flex-col gap-3 px-6 py-5 ${CARD_CLASS}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="special-pages" className="text-title text-ink">{w.cards.own}</h2>
            <span className="text-sm text-muted">{ownCount === 0 ? countWords(ownRoles.length, w.cards.allStandard) : countWords(ownCount, w.cards.someOwn)}</span>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-8">
            <OwnPageRow id="front" name={w.front.title} current={frontPage ? frontPage.title || site.list.untitled : null} standard={w.cards.products} words={w.cards}>
              <FrontPageForm
                storeSlug={store.slug}
                words={w}
                shared={site.list}
                current={store.frontPageId}
                pages={choices.filter((p) => p.id !== store.productsPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.frontPageId))}
              />
            </OwnPageRow>
            {/* A website (D178 step 5: the online shop off) has no All products page; one chosen keeps its place for when the shop is on. */}
            {featureOn(store, "shop") && (
              <OwnPageRow id="products" name={w.front.all} current={titleOf(store.productsPageId)} standard={w.cards.standard} words={w.cards}>
                <ProductsPageForm
                  storeSlug={store.slug}
                  words={w}
                  shared={site.list}
                  current={store.productsPageId}
                  pages={choices.filter((p) => p.id !== store.frontPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.productsPageId))}
                />
              </OwnPageRow>
            )}
            {ownRoles.map((role) => (
              <OwnPageRow key={role} id={role} name={site.list.roles[role] ?? ROLE_COPY[role].name} current={titleOf(store.pageRoles[role] ?? null)} standard={w.cards.standard} words={w.cards}>
                <PageRoleForm
                  storeSlug={store.slug}
                  words={w}
                  shared={site.list}
                  role={role}
                  current={store.pageRoles[role] ?? null}
                  pages={choices.filter(
                    (p) => p.id !== store.frontPageId && p.id !== store.productsPageId && (!roleIds.has(p.id) || p.id === store.pageRoles[role]) && (p.state !== "draft" || p.id === store.pageRoles[role]),
                  )}
                />
              </OwnPageRow>
            ))}
          </ul>
          <p className="text-sm text-muted">{w.cards.changeNote}</p>
        </section>
        </PhoneRow>
        </div>
      )}
    </div>
    </AdminTextScope>
  );
}

/**
 * One of the shop's own pages in the list (D615): its name, the page it shows or the standard, and Change, which opens a small window
 * (a popover, no script needed) holding the choice and the start of a new page.
 */
function OwnPageRow({ id, name, current, standard, words, children }: { id: string; name: string; current: string | null; standard: string; words: ListWords["cards"]; children: ReactNode }) {
  const windowId = `own-page-${id}`;
  return (
    <li className="flex min-h-11 items-center gap-3 border-b border-line">
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
      <Chip signal={current ? "insight" : "neutral"}>{current ?? standard}</Chip>
      <button type="button" popoverTarget={windowId} className="min-h-9 text-sm font-medium text-brand-text underline-offset-2 hover:underline">
        {words.change}
        <span className="sr-only"> {name}</span>
      </button>
      <div
        id={windowId}
        popover="auto"
        role="dialog"
        aria-label={name}
        className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-panel border border-line bg-card p-0 text-ink shadow-[var(--shadow-float)] backdrop:bg-ink/30"
      >
        <div className="flex flex-col gap-2 p-2">
          {children}
          <button type="button" popoverTarget={windowId} popoverTargetAction="hide" className={`self-end ${buttonClass("quiet", "dense")}`}>
            {words.close}
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * Which page shoppers land on (D54): the product list, or one of the store's
 * published pages, in every country it sells to.
 */
function FrontPageForm({
  storeSlug,
  words,
  shared,
  current,
  pages,
}: {
  storeSlug: string;
  words: ListWords;
  shared: SharedWords;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  const f = words.front;
  return (
    <ActionForm
      action={setFrontPageAction.bind(null, storeSlug)}
      className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}
    >
      <h2 className="text-title text-ink">{f.title}</h2>
      <p className="max-w-2xl text-sm text-muted">{f.hint}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {f.label}
          <select name="frontPage" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{f.all}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || shared.untitled}
                {page.state === "draft" ? shared.notPublished : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>{shared.save}</SubmitButton>
      </div>
      {unpublished && <p className="text-sm text-muted">{f.unpublished}</p>}
    </ActionForm>
  );
}

/** Which page is the store's All products page at /products (D83), or the standard list. */
function ProductsPageForm({
  storeSlug,
  words,
  shared,
  current,
  pages,
}: {
  storeSlug: string;
  words: ListWords;
  shared: SharedWords;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  const f = words.products;
  return (
    <ActionForm
      action={setProductsPageAction.bind(null, storeSlug)}
      className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}
    >
      <h2 className="text-title text-ink">{f.title}</h2>
      <p className="max-w-2xl text-sm text-muted">{f.hint}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {f.label}
          <select name="productsPage" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{f.standard}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || shared.untitled}
                {page.state === "draft" ? shared.notPublished : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>{shared.save}</SubmitButton>
      </div>
      {unpublished && <p className="text-sm text-muted">{f.unpublished}</p>}
    </ActionForm>
  );
}

/**
 * Which page is one of the store's special places (D112, D113): its blog,
 * search page, 404 page or one of its working pages, or the standard one; and a starter page to begin from,
 * which looks like the standard page and is published in place.
 */
function PageRoleForm({
  storeSlug,
  words,
  shared,
  role,
  current,
  pages,
}: {
  storeSlug: string;
  words: ListWords;
  shared: SharedWords;
  role: PageRole;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  // The place's name (`list.roles`) and its standard page and hint (`storePages.roles`), in the admin's language.
  const name = shared.roles[role] ?? ROLE_COPY[role].name;
  const { standard, hint } = words.roles[role] ?? ROLE_COPY[role];
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <Card title={name} description={hint} level={4} className="flex flex-col gap-3" compact>
      <ActionForm action={setPageRoleAction.bind(null, storeSlug, role)} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {fillWords(words.role.shows, { name })}
          <select name="page" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{standard}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || shared.untitled}
                {page.state === "draft" ? shared.notPublished : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>{shared.save}</SubmitButton>
      </ActionForm>
      <ActionForm action={createRolePageAction.bind(null, storeSlug, role)} className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">{words.role.start}</SubmitButton>
        <span className="text-sm text-muted">{words.role.startHint}</span>
      </ActionForm>
      {unpublished && <p className="text-sm text-muted">{fillWords(words.role.unpublished, { standard: standard.charAt(0).toLowerCase() + standard.slice(1) })}</p>}
    </Card>
  );
}

/** A store's product layouts (D79): name, state and when published. */
function ProductLayoutsTable({
  layouts,
  adminBase,
  uses,
  terms,
  words,
  shared,
  locale,
}: {
  layouts: PageSummary[];
  adminBase: string;
  uses: Map<string, LayoutUse>;
  terms: Term[];
  words: ListWords["layouts"];
  shared: SharedWords;
  /** The admin's locale, for the dates. */
  locale: string;
}) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const names = (ids: string[]) => ids.map((id) => terms.find((term) => term.id === id)?.name).filter(Boolean).join(", ");
  const usedFor = (id: string) => {
    const use = uses.get(id);
    if (!use) return words.notUsed;
    return (
      [
        use.standard && words.standard,
        use.categoryIds.length > 0 && fillWords(words.categories, { names: names(use.categoryIds) }),
        use.tagIds.length > 0 && fillWords(words.tags, { names: names(use.tagIds) }),
        use.products > 0 && countWords(use.products, words.products),
      ]
        .filter(Boolean)
        .join(" · ") || words.notUsed
    );
  };
  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-4 py-2 font-medium">
              {words.layout}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {words.state}
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              {words.usedFor}
            </th>
          </tr>
        </thead>
        <tbody>
          {layouts.map((layout) => (
            <tr key={layout.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2">
                <Link href={`${adminBase}/${layout.id}`} className="font-medium underline">
                  {layout.title || shared.untitled}
                </Link>
              </td>
              <td className="px-4 py-2">
                {shared.layoutStates[layout.state]}
                {layout.publishedAt && <span className="block text-muted">{fillWords(shared.publishedOn, { date: date.format(new Date(layout.publishedAt)) })}</span>}
              </td>
              <td className="px-4 py-2">
                {usedFor(layout.id)}
                <Link href={`${adminBase}/${layout.id}/assign`} className="block w-fit underline">
                  {words.whereUsed}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/** Whether a store's Special pages offer a place (D178): its working page's feature is on, or a page is chosen for it already. */
function roleOffered(store: { features: readonly string[]; pageRoles: Partial<Record<string, string>> }, role: PageRole): boolean {
  const part = partOfRole(role);
  // The search page finds products (D72): a website (the online shop off, D178 step 5) has none.
  const feature = role === "search" ? "shop" : part ? shopPartFeature(part) : undefined;
  return requirementMet(store, feature) || Boolean(store.pageRoles[role]);
}
