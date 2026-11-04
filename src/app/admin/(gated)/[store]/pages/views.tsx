import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DemoHomePages } from "@/components/admin/demo-home-pages";
import { AdminTextScope } from "@/components/admin/admin-text";
import { PageJobsPanel } from "@/components/admin/page-jobs-panel";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { fillWords, countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { WebsiteMessages } from "@/lib/admin-messages/website.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { ROLE_COPY, ROLE_GROUPS, partOfRole, type PageRole } from "@/lib/page-roles";
import { featureOn, requirementMet } from "@/lib/store-features";
import { shopPartFeature } from "@/lib/store-parts";
import type { Term } from "@/lib/taxonomy";
import { latestHomeTake, homePageOffers } from "@/server/home-takes";
import { memberCan, requirePageTypeAccess } from "@/server/permissions";
import { listPages, type PageSummary } from "@/server/pages";
import { runningPageJobs } from "@/server/page-jobs";
import { scheduleChips } from "@/server/page-schedules";
import { isScheduledType } from "@/lib/page-schedules";
import { layoutUses, type LayoutUse } from "@/server/product-layouts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { listTerms } from "@/server/taxonomy";
import { Card, CARD_CLASS, CountBadge, PageHeader } from "@/components/admin/ui";
import { commentCounts } from "@/server/blog-comments";

import {
  chooseStoreSiteLayoutAction,
  createRolePageAction,
  createStorePageTermAction,
  deleteStorePageTermAction,
  setFrontPageAction,
  setPageRoleAction,
  setProductsPageAction,
  stopPageJobAction,
  updateStorePageTermAction,
} from "./actions";
import { termFieldsSetup } from "../fields/data";
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

export async function StorePagesListView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams: Query }) {
  const gated = await requirePageTypeAccess((await params).store, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store } = gated;
  const [pages, query] = await Promise.all([listPages(store.id, type), searchParams]);
  const base = storePagesBase(store, type);
  const context = await storePageContext(store, type);
  // Pages that have a place of their own (D112) are not offered for another.
  const roleIds = new Set(Object.values(store.pageRoles));
  const lang = adminLangOf(gated.account.adminLocale);
  const blogWords = adminText(lang, "blog");
  const site = adminText(lang, "website");
  const w = site.storePages;
  const tw = w.types[type];
  const waitingComments = type === "article" ? (await commentCounts(store.id)).pending : 0;
  // What is scheduled for each page, article, header or footer, and what did not happen (D340), on the store's clock.
  const clock = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const schedules = isScheduledType(type) ? await scheduleChips(store.id, type, adminText(lang, "schedules").chips, (iso) => clock.format(new Date(iso))) : {};
  return (
    <AdminTextScope texts={adminTexts(adminLangOf(gated.account.adminLocale), ["website", "schedules"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title={tw.list} description={tw.intro} />
        <div className="flex flex-wrap gap-2">
          {!LAYOUT_TYPES.includes(type) && (
            <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
              {w.categories}
            </Link>
          )}
          {/* The store's blogs, their authors and the comments waiting (D341). */}
          {type === "article" && (
            <>
              <Link href={`${base}/blogs`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
                {blogWords.links.blogs}
              </Link>
              <Link href={`${base}/comments`} className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-edge px-4 text-sm font-medium">
                {blogWords.links.comments}
                {waitingComments > 0 && <CountBadge count={waitingComments} />}
              </Link>
            </>
          )}
          {type === "page" && (
            <Link href={`${base}/ai`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium">
              {w.createAi}
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
      {query.deleted && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {tw.deleted}
        </p>
      )}
      {/* The AI's page work still going (PSI UX-01): builds and pictures, with a Stop for who may change the site. */}
      {(type === "page" || type === "article") && (
        <PageJobsPanel
          jobs={await runningPageJobs(store.id)}
          pagesBase={storePagesBase(store, "page")}
          articlesBase={storePagesBase(store, "article")}
          stop={memberCan(gated, "website:write") ? stopPageJobAction.bind(null, store.slug) : undefined}
        />
      )}
      {pages.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {tw.none}
        </p>
      ) : type === "product_layout" ? (
        <ProductLayoutsTable
          layouts={pages}
          adminBase={base}
          uses={await layoutUses(store.id)}
          terms={await listTerms({ storeId: store.id, contentType: "product" })}
          words={w.layouts}
          shared={site.list}
          locale={ADMIN_LANG_FACTS[lang].locale}
        />
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={(await siteLayoutChoice(store.id))[type]} schedules={schedules} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={context.siteBase}
          frontPageId={type === "page" ? store.frontPageId : null}
          productsPageId={type === "page" ? store.productsPageId : null}
          roles={type === "page" ? Object.fromEntries(Object.entries(store.pageRoles).map(([role, id]) => [id, role as PageRole])) : {}}
          schedules={schedules}
          duplicate={context.actions.duplicate}
        />
      )}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={(await siteLayoutChoice(store.id))[type]}
          siteName={w.siteName}
          action={chooseStoreSiteLayoutAction.bind(null, store.slug, type)}
        />
      )}
      {type === "page" && (
        <FrontPageForm
          storeSlug={store.slug}
          words={w}
          shared={site.list}
          current={store.frontPageId}
          pages={pages.filter((p) => p.id !== store.productsPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.frontPageId))}
        />
      )}
      {/* A demo store's home page as the front page, and the store's own put back (docs/theme-showcase-phase-1.md step 4c). */}
      {type === "page" && memberCan(gated, "website:write") && (
        <DemoHomePages
          offers={await homePageOffers()}
          take={await latestHomeTake(store.id)}
          editBase={base}
          use={useDemoHomeAction.bind(null, store.slug)}
          undo={undoDemoHomeAction.bind(null, store.slug)}
        />
      )}
      {/* A website (D178 step 5: the online shop off) has no All products page; one chosen keeps its place for when the shop is on. */}
      {type === "page" && featureOn(store, "shop") && (
        <ProductsPageForm
          storeSlug={store.slug}
          words={w}
          shared={site.list}
          current={store.productsPageId}
          pages={pages.filter((p) => p.id !== store.frontPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.productsPageId))}
        />
      )}
      {type === "page" && (
        <section className="flex flex-col gap-4" aria-labelledby="special-pages">
          <div className="flex flex-col gap-1">
            <h2 id="special-pages" className="text-title text-ink">{w.special}</h2>
            <p className="max-w-2xl text-sm text-muted">{w.specialNote}</p>
          </div>
          {ROLE_GROUPS.map((group) => (
            <div key={group.name} className="flex flex-col gap-3">
              <h3 className="text-muted text-body-strong text-ink">{(w.groups as Record<string, string | undefined>)[group.name] ?? group.name}</h3>
              {/* A working page of a store feature that is off (D178) is not offered; one already chosen stays, so it can be changed. */}
              {group.roles.filter((role) => roleOffered(store, role)).map((role) => (
                <PageRoleForm
                  key={role}
                  storeSlug={store.slug}
                  words={w}
                  shared={site.list}
                  role={role}
                  current={store.pageRoles[role] ?? null}
                  pages={pages.filter(
                    (p) => p.id !== store.frontPageId && p.id !== store.productsPageId && (!roleIds.has(p.id) || p.id === store.pageRoles[role]) && (p.state !== "draft" || p.id === store.pageRoles[role]),
                  )}
                />
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
    </AdminTextScope>
  );
}

/** A store's page or article categories and tags (D50, D53, D57): chosen in the editor, shown by content grids. */
export async function StorePageTermsView({ type, params }: { type: PageType; params: StoreParams }) {
  const gated = await requirePageTypeAccess((await params).store, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const tw = adminText(adminLangOf(account.adminLocale), "website").storePages.types[type];
  const [terms, fields] = await Promise.all([listTerms({ storeId: store.id, contentType: termContentOf(type) }), termFieldsSetup(store)]);
  return (
    // The categories manager's words are the products' (it is the same manager as theirs).
    <AdminTextScope texts={adminTexts(adminLangOf(account.adminLocale), ["products"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={storePagesBase(store, type)} className="w-fit text-sm underline">
          {tw.list}
        </Link>
        <PageHeader title={tw.termsTitle} description={tw.terms} />
        </div>
      <TermsManager
        initial={terms}
        usedBy={tw.many}
        fields={fields}
        actions={{
          create: createStorePageTermAction.bind(null, store.slug, type),
          update: updateStorePageTermAction.bind(null, store.slug, type),
          remove: deleteStorePageTermAction.bind(null, store.slug, type),
        }}
      />
    </div>
    </AdminTextScope>
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
