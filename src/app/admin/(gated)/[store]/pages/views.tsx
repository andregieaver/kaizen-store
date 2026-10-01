import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { ROLE_COPY, ROLE_GROUPS, type PageRole } from "@/lib/page-roles";
import type { Term } from "@/lib/taxonomy";
import { requireMember } from "@/server/auth";
import { getPageForEdit, listPages, type PageSummary } from "@/server/pages";
import { layoutUses, type LayoutUse } from "@/server/product-layouts";
import { listSavedParts } from "@/server/saved-parts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { bothTerms, listTerms } from "@/server/taxonomy";
import { getFieldData } from "@/server/custom-fields";

import {
  chooseStoreSiteLayoutAction,
  createRolePageAction,
  createStorePageTermAction,
  deleteStorePageTermAction,
  setFrontPageAction,
  setPageRoleAction,
  setProductsPageAction,
  updateStorePageTermAction,
} from "./actions";
import { termFieldsSetup } from "../fields/data";
import { storePageContext, storePagesBase } from "./context";
import { PageDrawing } from "./drawing";

/**
 * A store's pages (D53) and blog articles (D57): the same list, editor,
 * preview and categories as Kaizen's, at `/admin/{store}/pages` and `/articles`.
 */

type StoreParams = Promise<{ store: string }>;
type PageParams = Promise<{ store: string; pageId: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

const INTRO: Record<PageType, string> = {
  page: "Pages of your own, such as About us or Delivery, in every country your store sells to. Save a page as a draft while you work on it; publish it to put it in your store, and add it to your menus under Header and footer.",
  article:
    "Your blog: articles at /blog/{address} in every country your store sells to, listed newest first at /blog. Save an article as a draft while you work on it; publish it to put it in the blog.",
  product_layout:
    "How your product pages are laid out: rows and columns of product components (pictures, title, price, buy, description …) with any other components around them. Publish a layout, then choose where it is used: for the whole store, for categories or tags, or for single products. Products without one use the standard layout.",
  header:
    "The top of every page in your store, built from components: your logo, menus, search, account, wishlist, cart, countries and anything else. Publish a header, then choose it as the store's header; until you do, the standard one is shown. Its logo and menus are the ones under Header and footer.",
  footer:
    "The bottom of every page in your store, built from components: your logo, menus, business details, countries, the cookies link and anything else. Publish a footer, then choose it as the store's footer; until you do, the standard one is shown. A footer shows your business details and the cookies link, as the law asks.",
  variant: "A version of a page made for an A/B test: edited here like the page, shown only to the visitors the test gives it to, never at an address of its own.",
};

export async function StorePagesListView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams: Query }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const [pages, query] = await Promise.all([listPages(store.id, type), searchParams]);
  const base = storePagesBase(store, type);
  const context = await storePageContext(store, type);
  // Pages that have a place of their own (D112) are not offered for another.
  const roleIds = new Set(Object.values(store.pageRoles));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy.list}</h1>
          <p className="max-w-2xl text-sm text-muted">{INTRO[type]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!LAYOUT_TYPES.includes(type) && (
            <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium">
              Categories and tags
            </Link>
          )}
          {type === "page" && (
            <Link href={`${base}/ai`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium">
              Create with AI
            </Link>
          )}
          <Link
            href={`${base}/new`}
            className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
          >
            New {copy.one}
          </Link>
        </div>
      </div>
      {query.deleted && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          The {copy.one} was deleted.
        </p>
      )}
      {pages.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          No {copy.many} yet. Make the first one with New {copy.one}.
        </p>
      ) : type === "product_layout" ? (
        <ProductLayoutsTable
          layouts={pages}
          adminBase={base}
          uses={await layoutUses(store.id)}
          terms={await listTerms({ storeId: store.id, contentType: "product" })}
        />
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={(await siteLayoutChoice(store.id))[type]} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={context.siteBase}
          frontPageId={type === "page" ? store.frontPageId : null}
          productsPageId={type === "page" ? store.productsPageId : null}
          roles={type === "page" ? Object.fromEntries(Object.entries(store.pageRoles).map(([role, id]) => [id, role as PageRole])) : {}}
          duplicate={context.actions.duplicate}
        />
      )}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={(await siteLayoutChoice(store.id))[type]}
          siteName="Your store"
          action={chooseStoreSiteLayoutAction.bind(null, store.slug, type)}
        />
      )}
      {type === "page" && (
        <FrontPageForm
          storeSlug={store.slug}
          current={store.frontPageId}
          pages={pages.filter((p) => p.id !== store.productsPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.frontPageId))}
        />
      )}
      {type === "page" && (
        <ProductsPageForm
          storeSlug={store.slug}
          current={store.productsPageId}
          pages={pages.filter((p) => p.id !== store.frontPageId && !roleIds.has(p.id) && (p.state !== "draft" || p.id === store.productsPageId))}
        />
      )}
      {type === "page" && (
        <section className="flex flex-col gap-4" aria-labelledby="special-pages">
          <div className="flex flex-col gap-1">
            <h2 id="special-pages" className="text-lg font-semibold">Special pages</h2>
            <p className="max-w-2xl text-sm text-muted">
              Your store&apos;s working pages, the blog and the 404 page have a standard look. Build any of them in the
              page builder instead: choose one of your published pages for it, or start from a new page that looks like
              the standard one. The standard page shows until you do.
            </p>
          </div>
          {ROLE_GROUPS.map((group) => (
            <div key={group.name} className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted">{group.name}</h3>
              {group.roles.map((role) => (
                <PageRoleForm
                  key={role}
                  storeSlug={store.slug}
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
  );
}

/** A store's page or article categories and tags (D50, D53, D57): chosen in the editor, shown by content grids. */
export async function StorePageTermsView({ type, params }: { type: PageType; params: StoreParams }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const [terms, fields] = await Promise.all([listTerms({ storeId: store.id, contentType: termContentOf(type) }), termFieldsSetup(store)]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={storePagesBase(store, type)} className="w-fit text-sm underline">
          {copy.list}
        </Link>
        <h1 className="text-2xl font-semibold">{copy.One} categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort your {copy.many} into categories and label them with tags; a content grid can then show the {copy.many}{" "}
          of a category or tag. Product categories are under Products.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy={copy.many}
        fields={fields}
        actions={{
          create: createStorePageTermAction.bind(null, store.slug, type),
          update: updateStorePageTermAction.bind(null, store.slug, type),
          remove: deleteStorePageTermAction.bind(null, store.slug, type),
        }}
      />
    </div>
  );
}

export async function StoreNewPageView({ type, params }: { type: PageType; params: StoreParams }) {
  const { store, account } = await requireMember((await params).store);
  const [saved, terms, gridTerms] = await Promise.all([
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(type) }),
    bothTerms(store.id),
  ]);
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">New {PAGE_TYPE_COPY[type].one}</h1>
      <PageEditor
        page={null}
        savedParts={saved}
        terms={terms}
        gridTerms={gridTerms}
        fieldRoles={[]}
        context={await storePageContext(store, type, account.name ?? "")}
      />
    </>
  );
}

/** One of a store's pages or articles in the editor, opened from its list or from the store. */
export async function StoreEditPageView({ type, params, searchParams }: { type: PageType; params: PageParams; searchParams: Query }) {
  const { store: storeSlug, pageId } = await params;
  const { store, account } = await requireMember(storeSlug);
  const [page, { saved: justSaved }, saved, terms, gridTerms] = await Promise.all([
    z.uuid().safeParse(pageId).success ? getPageForEdit(store.id, pageId, type) : null,
    searchParams,
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(type) }),
    bothTerms(store.id),
  ]);
  if (!page) notFound();
  const context = await storePageContext(store, type, account.name ?? "");
  // What is entered in the page's or article's custom fields (D118).
  const fieldData = type === "page" || type === "article" ? await getFieldData(store.id, type, page.id) : undefined;
  return (
    <>
      <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={
          justSaved === "draft"
            ? "Draft saved."
            : justSaved === "published"
              ? LAYOUT_TYPES.includes(type)
                ? "Published."
                : `Published at ${context.siteBase}/${page.slug}.`
              : null
        }
        savedParts={saved}
        terms={terms}
        gridTerms={gridTerms}
        fieldData={fieldData}
        fieldRoles={Object.entries(store.pageRoles).filter(([, id]) => id === page.id).map(([role]) => role)}
        context={context}
      />
    </>
  );
}

/** The last saved draft of a store's page or article, as the store will show it once published. */
export async function StorePreviewPageView({
  type,
  params,
  searchParams,
}: {
  type: PageType;
  params: PageParams;
  /** A product layout's preview (D79): `product`, the product it is shown with. */
  searchParams?: Query;
}) {
  const { store: storeSlug, pageId } = await params;
  const { store } = await requireMember(storeSlug);
  const page = z.uuid().safeParse(pageId).success ? await getPageForEdit(store.id, pageId, type) : null;
  if (!page) notFound();
  const copy = PAGE_TYPE_COPY[type];
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background">
        <span>
          Preview of the saved draft.{" "}
          {page.state === "draft"
            ? `The ${copy.one} is not in your store yet.`
            : page.state === "changed"
              ? "Your store still shows the published version."
              : "This is what your store shows."}
        </span>
        <Link href={`${storePagesBase(store, type)}/${page.id}`} className="font-medium underline">
          Back to editing
        </Link>
      </p>
      <PageDrawing
        store={store}
        type={type}
        id={page.id}
        content={page.draft}
        publishedAt={page.publishedAt}
        asked={(await searchParams)?.product}
      />
    </div>
  );
}

/**
 * Which page shoppers land on (D54): the product list, or one of the store's
 * published pages, in every country it sells to.
 */
function FrontPageForm({
  storeSlug,
  current,
  pages,
}: {
  storeSlug: string;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <ActionForm
      action={setFrontPageAction.bind(null, storeSlug)}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
    >
      <h2 className="font-medium">Front page</h2>
      <p className="max-w-2xl text-sm text-muted">
        What shoppers see first in your store: your products, or one of your published pages (with a content grid of
        products, for instance).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          Your store opens with
          <select name="frontPage" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">
            <option value="">All products</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                {page.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </div>
      {unpublished && (
        <p className="text-sm text-muted">
          This page is not published, so shoppers see your products until you publish it again.
        </p>
      )}
    </ActionForm>
  );
}

/** Which page is the store's All products page at /products (D83), or the standard list. */
function ProductsPageForm({
  storeSlug,
  current,
  pages,
}: {
  storeSlug: string;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <ActionForm
      action={setProductsPageAction.bind(null, storeSlug)}
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
    >
      <h2 className="font-medium">All products page</h2>
      <p className="max-w-2xl text-sm text-muted">
        What shoppers see at All products (/products, where menus&apos; All products link goes): the standard list, or one
        of your published pages. Give its content grid of products the Filter and sort button so shoppers can narrow it.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          All products shows
          <select name="productsPage" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">
            <option value="">The standard list</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                {page.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </div>
      {unpublished && (
        <p className="text-sm text-muted">This page is not published, so shoppers see the standard list until you publish it again.</p>
      )}
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
  role,
  current,
  pages,
}: {
  storeSlug: string;
  role: PageRole;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
}) {
  const copy = ROLE_COPY[role];
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5" aria-labelledby={`role-${role}`}>
      <h4 id={`role-${role}`} className="font-medium">{copy.name}</h4>
      <p className="max-w-2xl text-sm text-muted">{copy.hint}</p>
      <ActionForm action={setPageRoleAction.bind(null, storeSlug, role)} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {copy.name} shows
          <select name="page" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">
            <option value="">{copy.standard}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                {page.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
      <ActionForm action={createRolePageAction.bind(null, storeSlug, role)} className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">Start from a new page</SubmitButton>
        <span className="text-sm text-muted">Makes a page like the standard one, publishes it here and opens it in the builder.</span>
      </ActionForm>
      {unpublished && <p className="text-sm text-muted">This page is not published, so shoppers see {copy.standard.toLowerCase()} until you publish it again.</p>}
    </section>
  );
}

/** A store's product layouts (D79): name, state and when published. */
function ProductLayoutsTable({
  layouts,
  adminBase,
  uses,
  terms,
}: {
  layouts: PageSummary[];
  adminBase: string;
  uses: Map<string, LayoutUse>;
  terms: Term[];
}) {
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
  const names = (ids: string[]) => ids.map((id) => terms.find((term) => term.id === id)?.name).filter(Boolean).join(", ");
  const usedFor = (id: string) => {
    const use = uses.get(id);
    if (!use) return "Not used yet";
    return (
      [
        use.standard && "The store's standard",
        use.categoryIds.length > 0 && `Categories: ${names(use.categoryIds)}`,
        use.tagIds.length > 0 && `Tags: ${names(use.tagIds)}`,
        use.products > 0 && (use.products === 1 ? "1 product" : `${use.products} products`),
      ]
        .filter(Boolean)
        .join(" · ") || "Not used yet"
    );
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2 font-medium">
              Layout
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              State
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Used for
            </th>
          </tr>
        </thead>
        <tbody>
          {layouts.map((layout) => (
            <tr key={layout.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <Link href={`${adminBase}/${layout.id}`} className="font-medium underline">
                  {layout.title || "Untitled"}
                </Link>
              </td>
              <td className="px-4 py-2">
                {LAYOUT_STATES[layout.state]}
                {layout.publishedAt && <span className="block text-muted">Published {date.format(new Date(layout.publishedAt))}</span>}
              </td>
              <td className="px-4 py-2">
                {usedFor(layout.id)}
                <Link href={`${adminBase}/${layout.id}/assign`} className="block w-fit underline">
                  Where it&apos;s used
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const LAYOUT_STATES: Record<PageSummary["state"], string> = {
  draft: "Draft",
  published: "Published",
  changed: "Published, with unpublished changes",
};
