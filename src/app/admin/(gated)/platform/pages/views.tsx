import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { PageArticle } from "@/components/page-article";
import type { PageType } from "@/lib/page-content";
import { requirePlatformAdmin } from "@/server/auth";
import { getPageForEdit, listPages } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { listTerms } from "@/server/taxonomy";

import { createPageTermAction, deletePageTermAction, updatePageTermAction } from "./actions";
import { platformPageContext } from "./context";

/**
 * Kaizen's pages (D42) and blog articles (D57): the same list, editor,
 * preview and categories, at `/admin/platform/pages` and `/articles`.
 */

type Query = Promise<Record<string, string | string[] | undefined>>;
type Params = Promise<{ pageId: string }>;

const INTRO: Record<PageType, string> = {
  page: "Kaizen's own pages, each at its own address on the site, such as /about. Save a page as a draft while you work on it; publish it to put it on the site. Add pages to the menus under Header and footer.",
  article:
    "Kaizen's blog: articles at /blog/{address}, listed newest first at /blog. Save an article as a draft while you work on it; publish it to put it in the blog.",
};

export async function PagesListView({ type, searchParams }: { type: PageType; searchParams: Query }) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const copy = PAGE_TYPE_COPY[type];
  const base = `/admin/platform/${copy.segment}`;
  const [pages, query] = await Promise.all([listPages(null, type), searchParams]);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy.list}</h1>
          <p className="max-w-2xl text-sm text-muted">{INTRO[type]}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href={`${base}/categories`} className="flex min-h-11 items-center rounded-md border border-border px-5 font-medium">
            Categories and tags
          </Link>
          <Link href={`${base}/new`} className="flex min-h-11 items-center rounded-md bg-foreground px-5 font-medium text-background">
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
        <PagesTable pages={pages} adminBase={base} siteBase={copy.sitePrefix} />
      )}
    </>
  );
}

export async function PageTermsView({ type }: { type: PageType }) {
  await connection();
  await requirePlatformAdmin();
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: null, contentType: type });
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href={`/admin/platform/${copy.segment}`} className="w-fit text-sm underline">
          {copy.list}
        </Link>
        <h1 className="text-2xl font-semibold">Categories and tags</h1>
        <p className="max-w-2xl text-sm text-muted">
          Sort Kaizen&apos;s {copy.many} into categories and label them with tags. Choose them for each {copy.one} in
          the editor; a content grid can then show the {copy.many} of a category or tag. The choices go on the site
          when the {copy.one} is published.
        </p>
      </div>
      <TermsManager
        initial={terms}
        usedBy={copy.many}
        actions={{
          create: createPageTermAction.bind(null, type),
          update: updatePageTermAction.bind(null, type),
          remove: deletePageTermAction.bind(null, type),
        }}
      />
    </>
  );
}

export async function NewPageView({ type }: { type: PageType }) {
  await connection();
  const admin = await requirePlatformAdmin();
  const [saved, terms, context] = await Promise.all([
    listSavedParts(null),
    listTerms({ storeId: null, contentType: type }),
    platformPageContext(type, admin.name ?? ""),
  ]);
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">New {PAGE_TYPE_COPY[type].one}</h1>
      <PageEditor page={null} savedParts={saved} terms={terms} context={context} />
    </>
  );
}

const load = async (type: PageType, params: Params) => {
  const { pageId } = await params;
  return z.uuid().safeParse(pageId).success ? getPageForEdit(null, pageId, type) : null;
};

/** One of Kaizen's pages or articles in the editor, opened from its list or from the site. */
export async function EditPageView({ type, params, searchParams }: { type: PageType; params: Params; searchParams: Query }) {
  await connection();
  const admin = await requirePlatformAdmin();
  const [page, { saved: justSaved }, saved, terms, context] = await Promise.all([
    load(type, params),
    searchParams,
    listSavedParts(null),
    listTerms({ storeId: null, contentType: type }),
    platformPageContext(type, admin.name ?? ""),
  ]);
  if (!page) notFound();
  const address = `${context.siteBase}/${page.slug}`;
  return (
    <>
      <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={justSaved === "draft" ? "Draft saved." : justSaved === "published" ? `Published at ${address}.` : null}
        savedParts={saved}
        terms={terms}
        context={context}
      />
    </>
  );
}

/** The last saved draft, as the site will show it once published (D42). */
export async function PreviewPageView({ type, params }: { type: PageType; params: Params }) {
  await connection();
  await requirePlatformAdmin();
  const page = await load(type, params);
  if (!page) notFound();
  const copy = PAGE_TYPE_COPY[type];
  return (
    <>
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background">
        <span>
          Preview of the saved draft.{" "}
          {page.state === "draft"
            ? `The ${copy.one} is not on the site yet.`
            : page.state === "changed"
              ? "The site still shows the published version."
              : "This is what the site shows."}
        </span>
        <Link href={`/admin/platform/${copy.segment}/${page.id}`} className="font-medium underline">
          Back to editing
        </Link>
      </p>
      <div className="py-6">
        <PageArticle content={page.draft} place={{ pageId: page.id, owner: null }} />
      </div>
    </>
  );
}
