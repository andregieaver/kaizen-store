import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { PageEditor } from "@/components/admin/page-editor";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PagePlaceForm } from "@/components/admin/page-place-form";
import { PagesTable } from "@/components/admin/pages-table";
import { TermsManager } from "@/components/admin/terms";
import { ArticleView } from "@/components/article-view";
import { SiteLayoutChoice, SiteLayoutsTable } from "@/components/admin/site-layouts";
import { PageArticle } from "@/components/page-article";
import { ScopedCss } from "@/components/custom-css";
import { KaizenSiteFooter, KaizenSiteHeader } from "@/components/site-parts";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { PLATFORM_ROLE_COPY, PLATFORM_ROLES, type PlatformRole } from "@/lib/platform-roles";
import { requirePlatformAdmin } from "@/server/auth";
import { getPageForEdit, listPages } from "@/server/pages";
import { getPlatformChrome } from "@/server/platform-navigation";
import { getPlatformPageRoles } from "@/server/platform-roles";
import { listSavedParts } from "@/server/saved-parts";
import { siteLayoutChoice } from "@/server/site-layouts";
import { bothTerms, listTerms } from "@/server/taxonomy";

import { choosePlatformSiteLayoutAction, createPageTermAction, createPlatformRolePageAction, setPlatformPageRoleAction, deletePageTermAction, updatePageTermAction } from "./actions";
import { platformPageContext } from "./context";
import { duplicatePageAction } from "./duplicate-action";

/**
 * Kaizen's pages (D42) and blog articles (D57): the same list, editor,
 * preview and categories, at `/admin/platform/pages` and `/articles`.
 */

type Query = Promise<Record<string, string | string[] | undefined>>;

type Params = Promise<{ pageId: string }>;

const INTRO: Record<PageType, string> = {
  page: "Kaizen's own pages, each at its own address on the site, such as /about. Save a page as a draft while you work on it; publish it to put it on the site. Add pages to the menus under Header and footer. Choose any page as Kaizen's front page, blog page or 404 page under Special pages.",
  article:
    "Kaizen's blog: articles at /blog/{address}, listed newest first at /blog. Save an article as a draft while you work on it; publish it to put it in the blog.",
  // Stores' own (D79); Kaizen has no products.
  product_layout: "",
  header:
    "The top of Kaizen's pages, built from components: the logo, menus, sign-in, the Start your store button and anything else. Publish a header, then choose it as the site's header; until you do, the standard one is shown.",
  footer:
    "The bottom of Kaizen's pages, built from components: the logo, menus, business details, the cookies link and anything else. Publish a footer, then choose it as the site's footer; until you do, the standard one is shown. A footer shows the business details and the cookies link, as the law asks.",
  // A store's A/B test copies (D148); Kaizen's own tests come later.
  variant: "",
};

export async function PagesListView({ type, searchParams }: { type: PageType; searchParams: Query }) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const copy = PAGE_TYPE_COPY[type];
  const base = `/admin/platform/${copy.segment}`;
  const [pages, query, roles] = await Promise.all([listPages(null, type), searchParams, type === "page" ? getPlatformPageRoles() : []]);
  // Pages that have a place of their own (D143) are not offered for another.
  const placedIds = new Set(roles.map(([, id]) => id));
  const roleOf = Object.fromEntries(roles.map(([role, id]) => [role, id]));
  const offered = (role: PlatformRole) => pages.filter((p) => (!placedIds.has(p.id) || p.id === roleOf[role]) && (p.state !== "draft" || p.id === roleOf[role]));
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{copy.list}</h1>
          <p className="max-w-2xl text-sm text-muted">{INTRO[type]}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!LAYOUT_TYPES.includes(type) && (
            <Link href={`${base}/categories`} className="flex min-h-11 items-center rounded-md border border-border px-5 font-medium">
              Categories and tags
            </Link>
          )}
          {type === "page" && (
            <Link href={`${base}/ai`} className="flex min-h-11 items-center rounded-md border border-border px-5 font-medium">
              Create with AI
            </Link>
          )}
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
      ) : type === "header" || type === "footer" ? (
        <SiteLayoutsTable layouts={pages} adminBase={base} current={(await siteLayoutChoice(null))[type]} />
      ) : (
        <PagesTable
          pages={pages}
          adminBase={base}
          siteBase={copy.sitePrefix}
          placed={Object.fromEntries(roles.map(([role, id]) => [id, { name: PLATFORM_ROLE_COPY[role].name, address: PLATFORM_ROLE_COPY[role].address }]))}
          duplicate={duplicatePageAction.bind(null, type)}
        />
      )}
      {type === "page" && (
        <section className="flex flex-col gap-4" aria-labelledby="special-pages">
          <div className="flex flex-col gap-1">
            <h2 id="special-pages" className="text-lg font-semibold">Special pages</h2>
            <p className="max-w-2xl text-sm text-muted">
              Kaizen&apos;s front page, blog and 404 page have a standard look. Build any of them in the page builder instead: choose one
              of your published pages for it, or start from a new page that looks like the standard one. The standard page shows until you do.
            </p>
          </div>
          {PLATFORM_ROLES.map((role) => (
            <PagePlaceForm
              key={role}
              id={role}
              name={PLATFORM_ROLE_COPY[role].name}
              hint={PLATFORM_ROLE_COPY[role].hint}
              standard={PLATFORM_ROLE_COPY[role].standard}
              current={roleOf[role] ?? null}
              pages={offered(role)}
              choose={setPlatformPageRoleAction.bind(null, role) as never}
              start={createPlatformRolePageAction.bind(null, role) as never}
            />
          ))}
        </section>
      )}
      {(type === "header" || type === "footer") && (
        <SiteLayoutChoice
          type={type}
          layouts={pages}
          current={(await siteLayoutChoice(null))[type]}
          siteName="Kaizen's site"
          action={choosePlatformSiteLayoutAction.bind(null, type)}
        />
      )}
    </>
  );
}

export async function PageTermsView({ type }: { type: PageType }) {
  await connection();
  await requirePlatformAdmin();
  const copy = PAGE_TYPE_COPY[type];
  const terms = await listTerms({ storeId: null, contentType: termContentOf(type) });
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
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
  ]);
  const gridTerms = await bothTerms(null);
  return (
    <>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">New {PAGE_TYPE_COPY[type].one}</h1>
      <PageEditor page={null} savedParts={saved} terms={terms} gridTerms={gridTerms} context={context} />
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
  const [page, { saved: justSaved }, saved, terms, context, gridTerms] = await Promise.all([
    load(type, params),
    searchParams,
    listSavedParts(null),
    listTerms({ storeId: null, contentType: termContentOf(type) }),
    platformPageContext(type, admin.name ?? ""),
    bothTerms(null),
  ]);
  if (!page) notFound();
  const address = `${context.siteBase}/${page.slug}`;
  return (
    <>
      <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
      <PageEditor
        key={page.id}
        page={page}
        notice={
          justSaved === "draft" ? "Draft saved." : justSaved === "published" ? (LAYOUT_TYPES.includes(type) ? "Published." : `Published at ${address}.`) : null
        }
        savedParts={saved}
        terms={terms}
        gridTerms={gridTerms}
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
      {/* Kaizen's own CSS and the page's (D100), kept inside the preview. */}
      <div className="py-6 [contain:paint]" data-site-css="">
        <ScopedCss css={[(await getPlatformChrome()).customCss, page.draft.css]} root="[data-site-css]" />
        {type === "header" || type === "footer" ? (
          // As Kaizen's pages draw it (D80), with its logo, menus and details.
          <div className="overflow-hidden rounded-lg border border-border">
            {type === "header" ? (
              <KaizenSiteHeader chrome={await getPlatformChrome()} layout={{ id: page.id, content: page.draft }} />
            ) : (
              <KaizenSiteFooter chrome={await getPlatformChrome()} layout={{ id: page.id, content: page.draft }} />
            )}
          </div>
        ) : type === "article" ? (
          // As the blog will show it (D57); the date is the day it is first published.
          <ArticleView
            content={page.draft}
            date={page.publishedAt}
            byline={page.draft.author || "Kaizen"}
            lang="en"
            locale="en-GB"
            place={{ pageId: page.id, owner: null }}
            inAdmin
          />
        ) : (
          <PageArticle content={page.draft} place={{ pageId: page.id, owner: null }} inAdmin />
        )}
      </div>
    </>
  );
}
