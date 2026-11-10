import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { PageEditor } from "@/components/admin/page-editor";
import { DualPageEditor, type DualDoc } from "@/components/admin/dual-page-editor";
import { parseDualLayout, templateAsPage, type DualKind, type DualLayout, type DualWith } from "@/lib/dual-page";
import type { AdminLang } from "@/lib/admin-lang";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LAYOUT_TYPES, termContentOf, type PageType } from "@/lib/page-content";
import { typeOfLayout } from "@/server/content-types";
import { checkPageTypeAccess, requirePageTypeAccess } from "@/server/permissions";
import { testOfVersionPage } from "@/server/experiment-admin";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { stagedCopy } from "@/server/site-staging";
import { bothTerms, listTerms } from "@/server/taxonomy";
import { getFieldData } from "@/server/custom-fields";

import { storePageContext, storePagesBase } from "./context";
import { PageDrawing } from "./drawing";
import { saveStagedPageAction } from "./staging-actions";

/** The catalogue areas the page editor's parts read (D312 A7): the builder, its components' fields, the font and picture pickers. */
const EDITOR_AREAS = ["builder", "blocks", "fields", "products", "design", "website", "blog", "schedules", "storeParts", "backdrops"] as const;

/**
 * A store's page editor and preview (D53, D57), apart from its lists (`views.tsx`): a list's route loads every client component its
 * modules import, drawn or not, so the builder's scripts load only where the builder is (PSI PERF-01).
 */

type StoreParams = Promise<{ store: string }>;
type PageParams = Promise<{ store: string; pageId: string }>;
type Query = Promise<Record<string, string | string[] | undefined>>;

/**
 * What a dual page shows (D412, D424), as the address asks (`?with=`, `?first=`, `?swap=`), with its second document loaded as its own
 * editor would load it: null where the address asks for no second half, "refused" where it names nothing this person may open.
 */
async function storeDual(
  storeSlug: string,
  first: { kind: DualKind; id: string | null },
  query: Record<string, string | string[] | undefined> | undefined,
  lang: AdminLang,
): Promise<{ layout: DualLayout; right: DualDoc | null } | "refused" | null> {
  if (query?.with === undefined) return null;
  const layout = parseDualLayout(first, { with: query.with, first: query.first, swap: query.swap });
  if (!layout) return "refused";
  if (typeof layout.second !== "object") return { layout, right: null };
  const right = await storeSecondDoc(storeSlug, layout.second, lang);
  return right === "refused" ? "refused" : { layout, right };
}

/** The second document of a dual page (D412), loaded as its own editor would load it; "refused" where this person may not open it. */
async function storeSecondDoc(storeSlug: string, doc: DualWith, lang: AdminLang): Promise<DualDoc | "refused"> {
  if (doc.kind === "template") return storeTemplateDoc(storeSlug, doc.id, lang);
  const member = await checkPageTypeAccess(storeSlug, doc.kind, "read");
  if (!member || (doc.kind === "product_layout" && requireFeature(member, "shop"))) return "refused";
  const { store, account } = member;
  const page = doc.id === null ? null : await getPageForEdit(store.id, doc.id, doc.kind);
  if (doc.id !== null && !page) return "refused";
  const entryType = doc.kind === "entry_layout" && page ? await typeOfLayout(store.id, page.id) : null;
  const [savedParts, terms, gridTerms, context, fieldData] = await Promise.all([
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(doc.kind) }),
    bothTerms(store.id),
    storePageContext(store, doc.kind, account.name ?? "", null, entryType),
    page && (doc.kind === "page" || doc.kind === "article") ? getFieldData(store.id, doc.kind, page.id) : undefined,
  ]);
  return {
    doc,
    kindName: adminText(lang, "builder").dual.kinds[doc.kind],
    props: {
      page,
      savedParts,
      terms,
      gridTerms,
      fieldData,
      fieldRoles: page ? Object.entries(store.pageRoles).filter(([, id]) => id === page.id).map(([role]) => role) : [],
      context,
    },
  };
}

/**
 * A saved template as the second document (D412 step 5): edited as the kind of page it is for (a page layout's own kind, a row, column or
 * component as a page's), in the store's main language only (its translations are its own, kept on save).
 */
async function storeTemplateDoc(storeSlug: string, id: string, lang: AdminLang): Promise<DualDoc | "refused"> {
  const builder = await checkPageTypeAccess(storeSlug, "page", "read");
  if (!builder) return "refused";
  const savedParts = await listSavedParts(builder.store.id);
  const part = savedParts.find((p) => p.id === id);
  if (!part) return "refused";
  const { shape, page } = templateAsPage(part);
  const member = shape === "page" ? builder : await checkPageTypeAccess(storeSlug, shape, "read");
  if (!member || (shape === "product_layout" && requireFeature(member, "shop"))) return "refused";
  const { store, account } = member;
  const [terms, gridTerms, context] = await Promise.all([
    listTerms({ storeId: store.id, contentType: termContentOf(shape) }),
    bothTerms(store.id),
    storePageContext(store, shape, account.name ?? ""),
  ]);
  return {
    doc: { kind: "template", id: part.id },
    kindName: adminText(lang, "builder").dual.kinds.template,
    props: {
      page,
      template: part,
      savedParts,
      terms,
      gridTerms,
      fieldRoles: [],
      context: { ...context, languages: context.languages.slice(0, 1), schedule: null, share: null },
    },
  };
}

/** A new page, article or layout in the editor; with `?with=`, beside a second document (D412). */
export async function StoreNewPageView({ type, params, searchParams }: { type: PageType; params: StoreParams; searchParams?: Query }) {
  const gated = await requirePageTypeAccess((await params).store, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const [saved, terms, gridTerms, query] = await Promise.all([
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(type) }),
    bothTerms(store.id),
    searchParams,
  ]);
  const context = await storePageContext(store, type, account.name ?? "");
  const dual = type === "variant" || !context.dualPages ? null : await storeDual(store.slug, { kind: type as DualKind, id: null }, query, lang);
  const props = { page: null, savedParts: saved, terms, gridTerms, fieldRoles: [], context };
  return (
    <AdminTextScope texts={adminTexts(lang, EDITOR_AREAS)}>
      {/* Only for screen readers: the title is in the editor, and the list is in the menu. */}
      <h1 className="sr-only">New {PAGE_TYPE_COPY[type].one}</h1>
      {dual && dual !== "refused" && context.dualPages ? (
        <DualPageEditor
          left={{ doc: { kind: type as DualKind, id: null }, kindName: adminText(lang, "builder").dual.kinds[type as DualKind], props }}
          right={dual.right}
          layout={dual.layout}
          root={context.dualPages.root}
          pick={{ ...context.dualPages, templates: saved }}
          site={{ css: context.siteCss, name: adminText(lang, "builder").editor.yourStore, save: context.actions.saveSiteCss, versions: context.actions.cssVersions }}
        />
      ) : (
        <PageEditor {...props} notice={dual === "refused" ? adminText(lang, "builder").dual.notOpened : null} />
      )}
    </AdminTextScope>
  );
}

/** One of a store's pages or articles in the editor, opened from its list or from the store. */
export async function StoreEditPageView({ type, params, searchParams }: { type: PageType; params: PageParams; searchParams: Query }) {
  const { store: storeSlug, pageId } = await params;
  const gated = await requirePageTypeAccess(storeSlug, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const [found, query, saved, terms, gridTerms] = await Promise.all([
    z.uuid().safeParse(pageId).success ? getPageForEdit(store.id, pageId, type) : null,
    searchParams,
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(type) }),
    bothTerms(store.id),
  ]);
  if (!found) notFound();
  const { saved: justSaved, staging: stagingMode } = query;
  // The staging set's copy of the page (D385): edited here in place of the page's own draft, which stays as it is.
  const staged = stagingMode === "1" ? await stagedCopy(store.id, found.id) : null;
  if (stagingMode === "1" && (!staged || staged.type !== type)) notFound();
  const page = staged ? { ...found, draft: staged.content } : found;
  // A version made for an A/B test (D148) says which test it is in, what it is a version of, and what may be changed in it.
  const test = type === "variant" ? await testOfVersionPage(store.id, page.id) : null;
  // An entry layout (D326) offers its type's fields to its blocks.
  const entryType = type === "entry_layout" ? await typeOfLayout(store.id, page.id) : null;
  const ownContext = await storePageContext(store, type, account.name ?? "", test?.targetType ?? null, entryType);
  const sw = adminText(adminLangOf(account.adminLocale), "website").staging;
  // In staging mode every save is the set's copy's (D385): no Publish, schedule or share link, which would act on the page itself.
  const context = staged
    ? {
        ...ownContext,
        schedule: null,
        share: null,
        dualPages: null,
        draftOnly: { preview: `${storePagesBase(store, type)}/${page.id}/preview?staging=1`, note: sw.stagedCopyNote },
        actions: { ...ownContext.actions, save: saveStagedPageAction.bind(null, store.slug, type) },
      }
    : ownContext;
  // What is entered in the page's or article's custom fields (D118).
  const fieldData = type === "page" || type === "article" ? await getFieldData(store.id, type, page.id) : undefined;
  const lang = adminLangOf(account.adminLocale);
  const ew = adminText(lang, "builder").editor;
  const notice =
    justSaved === "draft"
      ? ew.draftSaved
      : justSaved === "published"
        ? LAYOUT_TYPES.includes(type)
          ? ew.publishedShort
          : fillWords(ew.publishedAt, { address: `${context.siteBase}/${page.slug}` })
        : null;
  const fieldRoles = Object.entries(store.pageRoles).filter(([, id]) => id === page.id).map(([role]) => role);
  // A second document beside this one (D412): never for the staging set's copy or an A/B test's version, which have screens of their own.
  const dual = staged || type === "variant" || !context.dualPages ? null : await storeDual(store.slug, { kind: type as DualKind, id: page.id }, query, lang);
  if (dual && dual !== "refused" && context.dualPages) {
    return (
      <AdminTextScope texts={adminTexts(lang, EDITOR_AREAS)}>
        <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
        <DualPageEditor
          left={{
            doc: { kind: type as DualKind, id: page.id },
            kindName: adminText(lang, "builder").dual.kinds[type as DualKind],
            props: { page, notice, savedParts: saved, terms, gridTerms, fieldData, fieldRoles, context },
          }}
          right={dual.right}
          layout={dual.layout}
          root={context.dualPages.root}
          pick={{ ...context.dualPages, templates: saved }}
          site={{ css: context.siteCss, name: ew.yourStore, save: context.actions.saveSiteCss, versions: context.actions.cssVersions }}
        />
      </AdminTextScope>
    );
  }
  return (
    <AdminTextScope texts={adminTexts(lang, EDITOR_AREAS)}>
      <h1 className="sr-only">Edit {page.draft.title || `Untitled ${PAGE_TYPE_COPY[type].one}`}</h1>
      {staged && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-insight-soft px-4 py-3 text-sm text-insight-text" data-staging-mode>
          <span>{sw.stagedCopyNote}</span>
          <Link href={`/admin/${store.slug}/staging`} className="font-medium underline">
            {sw.backToStaging}
          </Link>
        </p>
      )}
      {test && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
          <span>
            {ew.testing} <strong>Version {test.key.toUpperCase()}</strong> against the original, in &ldquo;{test.name}&rdquo;.{" "}
            {test.part ? `Change ${test.part} only: the rest of the page has to stay as it is.` : "Change what you want to try, and publish it."}
            {test.status !== "draft" && " The test has started, so a change here is not published until it stops."}
          </span>
          <span className="flex gap-4">
            <Link href={`/admin/${store.slug}/${PAGE_TYPE_COPY[test.targetType].segment}/${test.pageId}/preview`} className="font-medium underline">
              {ew.lookAtOriginal}
            </Link>
            <Link href={`/admin/${store.slug}/experiments/${test.id}`} className="font-medium underline">
              {ew.backToTest}
            </Link>
          </span>
        </p>
      )}
      <PageEditor
        key={page.id}
        page={page}
        notice={dual === "refused" ? adminText(lang, "builder").dual.notOpened : notice}
        savedParts={saved}
        terms={terms}
        gridTerms={gridTerms}
        fieldData={fieldData}
        fieldRoles={fieldRoles}
        context={context}
      />
    </AdminTextScope>
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
  const gated = await requirePageTypeAccess(storeSlug, type, "read");
  // Product layouts are part of the online shop (D178 step 5): hidden while it is off.
  const shopOff = type === "product_layout" ? requireFeature(gated, "shop") : null;
  if (shopOff) return shopOff;
  const { store } = gated;
  const ew = adminText(adminLangOf(gated.account.adminLocale), "builder").editor;
  const found = z.uuid().safeParse(pageId).success ? await getPageForEdit(store.id, pageId, type) : null;
  if (!found) notFound();
  // `?staging=1`: the staging set's copy (D385), drawn in place of the page's own draft.
  const query = await searchParams;
  const staged = query?.staging === "1" ? await stagedCopy(store.id, found.id) : null;
  if (query?.staging === "1" && !staged) notFound();
  const page = staged ? { ...found, draft: staged.content } : found;
  const copy = PAGE_TYPE_COPY[type];
  // A version made for an A/B test (D148) is drawn as the kind of page it stands in for.
  const drawnAs: PageType = type === "variant" ? ((await testOfVersionPage(store.id, page.id))?.targetType ?? "page") : type;
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
        <span>
          {staged ? "Preview of the staging set's copy. " : "Preview of the saved draft. "}
          {page.state === "draft"
            ? `The ${copy.one} is not in your store yet.`
            : page.state === "changed"
              ? "Your store still shows the published version."
              : "This is what your store shows."}
        </span>
        <Link href={`${storePagesBase(store, type)}/${page.id}${staged ? "?staging=1" : ""}`} className="font-medium underline">
          {ew.backToEditing}
        </Link>
      </p>
      <PageDrawing
        store={store}
        type={drawnAs}
        id={page.id}
        content={page.draft}
        publishedAt={page.publishedAt}
        asked={query?.product}
      />
    </div>
  );
}
