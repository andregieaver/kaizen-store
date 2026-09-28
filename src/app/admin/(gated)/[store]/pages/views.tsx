import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { ArticleView } from "@/components/article-view";
import { PageArticle } from "@/components/page-article";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { ProductLayoutView } from "@/components/product-parts";
import { StoreSiteFooter, StoreSiteHeader } from "@/components/site-parts";
import { t } from "@/lib/i18n";
import { LAYOUT_TYPES, termContentOf, type PageContent, type PageType } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";
import { requireMember } from "@/server/auth";
import { getProduct, listProducts } from "@/server/catalog";
import { getPageForEdit, listPages, type PageSummary } from "@/server/pages";
import { layoutUses, type LayoutUse } from "@/server/product-layouts";
import type { Store } from "@/server/stores";
import { listSavedParts } from "@/server/saved-parts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { bothTerms, listTerms } from "@/server/taxonomy";

import {
  chooseStoreSiteLayoutAction,
  createStorePageTermAction,
  deleteStorePageTermAction,
  setFrontPageAction,
  setProductsPageAction,
  updateStorePageTermAction,
} from "./actions";
import { storePageContext, storePagesBase } from "./context";

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
};

export async function StorePagesListView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams: Query }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const [pages, query] = await Promise.all([listPages(store.id, type), searchParams]);
  const base = storePagesBase(store, type);
  const context = await storePageContext(store, type);
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
          pages={pages.filter((p) => p.id !== store.productsPageId && (p.state !== "draft" || p.id === store.frontPageId))}
        />
      )}
      {type === "page" && (
        <ProductsPageForm
          storeSlug={store.slug}
          current={store.productsPageId}
          pages={pages.filter((p) => p.id !== store.frontPageId && (p.state !== "draft" || p.id === store.productsPageId))}
        />
      )}
    </div>
  );
}

/** A store's page or article categories and tags (D50, D53, D57): chosen in the editor, shown by content grids. */
export async function StorePageTermsView({ type, params }: { type: PageType; params: StoreParams }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: store.id, contentType: termContentOf(type) });
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
  const [saved, library, terms, gridTerms] = await Promise.all([
    listSavedParts(store.id),
    // Kaizen's saved parts, to start from (D56).
    listSavedParts(null),
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
        library={library}
        terms={terms}
        gridTerms={gridTerms}
        context={await storePageContext(store, type, account.name ?? "")}
      />
    </>
  );
}

/** One of a store's pages or articles in the editor, opened from its list or from the store. */
export async function StoreEditPageView({ type, params, searchParams }: { type: PageType; params: PageParams; searchParams: Query }) {
  const { store: storeSlug, pageId } = await params;
  const { store, account } = await requireMember(storeSlug);
  const [page, { saved: justSaved }, saved, library, terms, gridTerms] = await Promise.all([
    z.uuid().safeParse(pageId).success ? getPageForEdit(store.id, pageId, type) : null,
    searchParams,
    listSavedParts(store.id),
    // Kaizen's saved parts, to start from (D56).
    listSavedParts(null),
    listTerms({ storeId: store.id, contentType: termContentOf(type) }),
    bothTerms(store.id),
  ]);
  if (!page) notFound();
  const context = await storePageContext(store, type, account.name ?? "");
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
        library={library}
        terms={terms}
        gridTerms={gridTerms}
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
      {type === "product_layout" ? (
        <LayoutPreview store={store} layout={page.draft} asked={(await searchParams)?.product} />
      ) : (type === "header" || type === "footer") && store.markets[0] ? (
        // As the store draws it (D80), in its first country, with its own logo, menus and details.
        <div className="overflow-hidden rounded-lg border border-border">
          {type === "header" ? (
            <StoreSiteHeader store={store} market={store.markets[0]} notice={null} layout={{ id: page.id, content: page.draft }} />
          ) : (
            <StoreSiteFooter store={store} market={store.markets[0]} layout={{ id: page.id, content: page.draft }} />
          )}
        </div>
      ) : type === "article" ? (
        // As the blog will show it (D57), in the store's main language.
        <ArticleView
          content={page.draft}
          date={page.publishedAt}
          byline={page.draft.author || store.name}
          lang={store.markets[0]?.lang ?? "en"}
          locale={store.markets[0]?.locale ?? "en-GB"}
          place={{ pageId: page.id, owner: store.id, market: store.markets[0]?.code }}
        />
      ) : (
        <PageArticle content={page.draft} place={{ pageId: page.id, owner: store.id, market: store.markets[0]?.code }} />
      )}
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

/**
 * A product layout's saved draft with one of the store's products (D79), in
 * its main market: the first product unless one is chosen.
 */
async function LayoutPreview({ store, layout, asked }: { store: Store; layout: PageContent; asked: string | string[] | undefined }) {
  const market = store.markets[0];
  const products = market ? await listProducts(store.id, market.code, market.locale) : [];
  const chosen = products.find((p) => p.handle === asked) ?? products[0];
  const product = chosen && market ? await getProduct(store.id, market.code, market.locale, chosen.handle) : null;
  if (!market || !product) return <p className="text-sm text-muted">Add a product with a price to see the layout with it.</p>;
  return (
    <>
      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1 font-medium">
          Shown with
          <select name="product" defaultValue={product.handle} className="min-h-10 rounded-md border border-border bg-background px-3">
            {products.map((p) => (
              <option key={p.handle} value={p.handle}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-md border border-border px-4 font-medium">
          Show
        </button>
      </form>
      <div className="rounded-lg border border-border py-8">
        <ProductLayoutView layout={layout} ctx={{ store, market, product, m: t(market.lang) }} />
      </div>
    </>
  );
}
