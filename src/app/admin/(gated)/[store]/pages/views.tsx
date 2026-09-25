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
import type { PageType } from "@/lib/page-content";
import { requireMember } from "@/server/auth";
import { getPageForEdit, listPages } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { bothTerms, listTerms } from "@/server/taxonomy";

import { createStorePageTermAction, deleteStorePageTermAction, setFrontPageAction, updateStorePageTermAction } from "./actions";
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
};

export async function StorePagesListView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams: Query }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const [pages, query] = await Promise.all([listPages(store.id, type), searchParams]);
  const base = storePagesBase(store, type);
  const context = storePageContext(store, type);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy.list}</h1>
          <p className="max-w-2xl text-sm text-muted">{INTRO[type]}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`${base}/categories`} className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium">
            Categories and tags
          </Link>
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
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={context.siteBase}
          frontPageId={type === "page" ? store.frontPageId : null}
        />
      )}
      {type === "page" && (
        <FrontPageForm
          storeSlug={store.slug}
          current={store.frontPageId}
          pages={pages.filter((p) => p.state !== "draft" || p.id === store.frontPageId)}
        />
      )}
    </div>
  );
}

/** A store's page or article categories and tags (D50, D53, D57): chosen in the editor, shown by content grids. */
export async function StorePageTermsView({ type, params }: { type: PageType; params: StoreParams }) {
  const { store } = await requireMember((await params).store);
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: store.id, contentType: type });
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
    listTerms({ storeId: store.id, contentType: type }),
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
        context={storePageContext(store, type, account.name ?? "")}
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
    listTerms({ storeId: store.id, contentType: type }),
    bothTerms(store.id),
  ]);
  if (!page) notFound();
  const context = storePageContext(store, type, account.name ?? "");
  return (
    <>
      <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={
          justSaved === "draft" ? "Draft saved." : justSaved === "published" ? `Published at ${context.siteBase}/${page.slug}.` : null
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
export async function StorePreviewPageView({ type, params }: { type: PageType; params: PageParams }) {
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
      {type === "article" ? (
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
