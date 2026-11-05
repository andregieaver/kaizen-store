import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PageEditor } from "@/components/admin/page-editor";
import { adminText, adminTexts } from "@/lib/admin-text";
import { termContentOf } from "@/lib/page-content";
import { SANDBOX_KINDS, isSandboxSegment, type SandboxKind } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getFieldData } from "@/server/custom-fields";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import type { Sandbox } from "@/server/sandbox";
import { bothTerms, listTerms } from "@/server/taxonomy";

import { sandboxPageContext } from "./context";
import { sandboxOf } from "./sandbox";

/** The catalogue areas the page editor's parts read (D312 A7), as the store's own editor hands them down. */
const EDITOR_AREAS = ["builder", "blocks", "fields", "products", "design", "website", "blog", "schedules"] as const;

type Params = Promise<{ sandbox: string; kind: string }>;

/** The sandbox and the kind of page an address names, or a 404 for a kind the sandbox does not offer. */
export async function sandboxAndKind(params: Params): Promise<{ sandbox: Sandbox | null; kind: SandboxKind }> {
  const { sandbox: id, kind: segment } = await params;
  if (!isSandboxSegment(segment)) notFound();
  return { sandbox: await sandboxOf(id), kind: SANDBOX_KINDS[segment] };
}

export const isPageId = (value: string) => z.uuid().safeParse(value).success;

/**
 * The page editor in a sandbox (D456): the same `PageEditor` as a store's, with the sandbox's context (`sandboxPageContext()`), a new page
 * when `pageId` is null. Saved and published say so in the builder's own words.
 */
export async function SandboxEditor({ sandbox, kind, pageId, saved }: { sandbox: Sandbox; kind: SandboxKind; pageId: string | null; saved: unknown }) {
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
  const notice = saved === "draft" ? ew.draftSaved : saved === "published" ? ew.publishedShort : null;
  const fieldData = found && kind === "page" ? await getFieldData(store.id, "page", found.id) : undefined;
  const fieldRoles = found ? Object.entries(store.pageRoles).filter(([, id]) => id === found.id).map(([role]) => role) : [];
  return (
    <AdminTextScope texts={adminTexts(lang, EDITOR_AREAS)}>
      <h1 className="sr-only">{found?.draft.title || untitled}</h1>
      <PageEditor
        key={found?.id ?? "new"}
        page={found}
        notice={notice}
        savedParts={savedParts}
        terms={terms}
        gridTerms={gridTerms}
        fieldData={fieldData}
        fieldRoles={fieldRoles}
        context={context}
      />
    </AdminTextScope>
  );
}
