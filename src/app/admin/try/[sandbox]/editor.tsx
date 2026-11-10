import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DualPageEditor, type DualDoc } from "@/components/admin/dual-page-editor";
import { PageEditor } from "@/components/admin/page-editor";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { parseDualLayout, templateAsPage, type DualKind, type DualLayout, type DualWith } from "@/lib/dual-page";
import { termContentOf } from "@/lib/page-content";
import { SANDBOX_KINDS, isSandboxSegment, type SandboxKind } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getFieldData } from "@/server/custom-fields";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import type { Sandbox } from "@/server/sandbox";
import { bothTerms, listTerms } from "@/server/taxonomy";

import { sandboxPageContext } from "./context";
import { offers, sandboxOf } from "./sandbox";

/** The catalogue areas the page editor's parts read (D312 A7), as the store's own editor hands them down. */
const EDITOR_AREAS = ["builder", "blocks", "fields", "products", "design", "website", "blog", "schedules", "storeParts", "backdrops"] as const;

type Params = Promise<{ sandbox: string; kind: string }>;
type Query = Record<string, string | string[] | undefined>;

/** The sandbox and the kind of page an address names, or a 404 for a kind the sandbox does not offer. */
export async function sandboxAndKind(params: Params): Promise<{ sandbox: Sandbox | null; kind: SandboxKind }> {
  const { sandbox: id, kind: segment } = await params;
  if (!isSandboxSegment(segment)) notFound();
  const sandbox = await sandboxOf(id);
  const kind = SANDBOX_KINDS[segment];
  if (sandbox && !offers(sandbox, kind)) notFound();
  return { sandbox, kind };
}

export const isPageId = (value: string) => z.uuid().safeParse(value).success;

const isOffered = (sandbox: Sandbox, kind: DualKind): kind is SandboxKind =>
  (Object.values(SANDBOX_KINDS) as string[]).includes(kind) && offers(sandbox, kind as SandboxKind);

/**
 * What a dual page shows in a sandbox (D412, D424; S4): as the store's own editor reads the address (`?with=`, `?first=`, `?swap=`), with its
 * second document loaded from the sandbox's own store: null where the address asks for no second half, "refused" where it names nothing the
 * sandbox has (another store's page, a kind it does not offer).
 */
async function sandboxDual(
  sandbox: Sandbox,
  first: { kind: DualKind; id: string | null },
  query: Query,
  lang: AdminLang,
): Promise<{ layout: DualLayout; right: DualDoc | null } | "refused" | null> {
  if (query.with === undefined) return null;
  const layout = parseDualLayout(first, { with: query.with, first: query.first, swap: query.swap });
  if (!layout) return "refused";
  if (typeof layout.second !== "object") return { layout, right: null };
  const right = await sandboxSecondDoc(sandbox, layout.second, lang);
  return right === "refused" ? "refused" : { layout, right };
}

/** The second document of a dual page: one of the sandbox's own pages, or one of its own saved templates, loaded as its editor loads it. */
async function sandboxSecondDoc(sandbox: Sandbox, doc: DualWith, lang: AdminLang): Promise<DualDoc | "refused"> {
  const { store } = sandbox;
  if (doc.kind === "template") {
    const savedParts = await listSavedParts(store.id);
    const part = savedParts.find((p) => p.id === doc.id);
    if (!part) return "refused";
    const { shape, page } = templateAsPage(part);
    if (!isOffered(sandbox, shape as DualKind)) return "refused";
    const [terms, gridTerms, context] = await Promise.all([
      listTerms({ storeId: store.id, contentType: termContentOf(shape) }),
      bothTerms(store.id),
      sandboxPageContext(sandbox, shape as SandboxKind),
    ]);
    return {
      doc: { kind: "template", id: part.id },
      kindName: adminText(lang, "builder").dual.kinds.template,
      props: { page, template: part, savedParts, terms, gridTerms, fieldRoles: [], context: { ...context, languages: context.languages.slice(0, 1) } },
    };
  }
  if (!isOffered(sandbox, doc.kind)) return "refused";
  const kind = doc.kind;
  const page = doc.id === null ? null : await getPageForEdit(store.id, doc.id, kind);
  if (doc.id !== null && !page) return "refused";
  const [savedParts, terms, gridTerms, context, fieldData] = await Promise.all([
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(kind) }),
    bothTerms(store.id),
    sandboxPageContext(sandbox, kind),
    page && (kind === "page" || kind === "article") ? getFieldData(store.id, kind, page.id) : undefined,
  ]);
  return {
    doc,
    kindName: adminText(lang, "builder").dual.kinds[kind],
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
 * The page editor in a sandbox (D457): the same `PageEditor` as a store's, with the sandbox's context (`sandboxPageContext()`), a new page
 * when `pageId` is null; with `?with=`, beside a second document of the sandbox's own (dual page, S4). Saved and published say so in the
 * builder's own words.
 */
export async function SandboxEditor({ sandbox, kind, pageId, query }: { sandbox: Sandbox; kind: SandboxKind; pageId: string | null; query: Query }) {
  const { store } = sandbox;
  const [lang, found, savedParts, terms, gridTerms, context] = await Promise.all([
    requestAdminLang(),
    pageId ? getPageForEdit(store.id, pageId, kind) : null,
    listSavedParts(store.id),
    listTerms({ storeId: store.id, contentType: termContentOf(kind) }),
    bothTerms(store.id),
    sandboxPageContext(sandbox, kind),
  ]);
  if (pageId && !found) notFound();
  const ew = adminText(lang, "builder").editor;
  const untitled = adminText(lang, "sandbox").home.untitled;
  const saved = query.saved;
  const notice = saved === "draft" ? ew.draftSaved : saved === "published" ? ew.publishedShort : null;
  const fieldData = found && (kind === "page" || kind === "article") ? await getFieldData(store.id, kind, found.id) : undefined;
  const fieldRoles = found ? Object.entries(store.pageRoles).filter(([, id]) => id === found.id).map(([role]) => role) : [];
  const props = { page: found, savedParts, terms, gridTerms, fieldData, fieldRoles, context };
  const dual = context.dualPages ? await sandboxDual(sandbox, { kind, id: found?.id ?? null }, query, lang) : null;
  return (
    <AdminTextScope texts={adminTexts(lang, EDITOR_AREAS)}>
      <h1 className="sr-only">{found?.draft.title || untitled}</h1>
      {dual && dual !== "refused" && context.dualPages ? (
        <DualPageEditor
          left={{ doc: { kind, id: found?.id ?? null }, kindName: adminText(lang, "builder").dual.kinds[kind], props }}
          right={dual.right}
          layout={dual.layout}
          root={context.dualPages.root}
          pick={{ ...context.dualPages, templates: savedParts }}
          site={{ css: context.siteCss, name: ew.yourStore, save: context.actions.saveSiteCss, versions: context.actions.cssVersions }}
        />
      ) : (
        <PageEditor key={found?.id ?? "new"} {...props} notice={dual === "refused" ? adminText(lang, "builder").dual.notOpened : notice} />
      )}
    </AdminTextScope>
  );
}
