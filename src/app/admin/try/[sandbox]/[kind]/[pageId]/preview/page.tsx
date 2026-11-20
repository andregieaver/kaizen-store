import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { sandboxBase } from "@/lib/sandbox";
import { BUILDER_WORDS } from "@/lib/admin-words/builder";
import { SANDBOX_WORDS } from "@/lib/admin-words/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getPageForEdit } from "@/server/pages";
import { publishedPageById } from "@/server/page-reads";

import { isPageId, sandboxAndKind } from "../../../params";

export const metadata: Metadata = { title: "Preview" };

/**
 * The last saved draft of a sandbox's page, header, footer, article or product layout, drawn as its store would show it (D457), as a store's
 * own *Preview* does; with `?published=1` (the builder's *View*), the published version instead, since the store's own address is private
 * and shows only its landing page. A product layout with the product `?product=` names, else the first.
 */
export default async function SandboxPreviewPage({ params, searchParams }: PageProps<"/admin/try/[sandbox]/[kind]/[pageId]/preview">) {
  const [{ sandbox, kind }, { pageId }, query] = await Promise.all([sandboxAndKind(params), params, searchParams]);
  if (!sandbox) return null;
  if (!isPageId(pageId)) notFound();
  const [lang, page] = await Promise.all([requestAdminLang(), getPageForEdit(sandbox.store.id, pageId, kind)]);
  if (!page) notFound();
  const ew = BUILDER_WORDS[lang].editor;
  const w = SANDBOX_WORDS[lang].view;
  const live = query.published === "1" && page.published ? ((await publishedPageById(sandbox.store.id, page.id, kind)) ?? undefined) : undefined;
  const note = query.published === "1" ? (live ? w.published : w.notPublished) : w.draft;
  return (
    <div className="flex flex-col gap-6 pt-4">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
        <span>{note}</span>
        <Link href={`${sandboxBase(sandbox.id, kind)}/${page.id}`} className="font-medium underline">
          {ew.backToEditing}
        </Link>
      </p>
      <PageDrawing
        store={sandbox.store}
        type={kind}
        id={page.id}
        content={live ? live.content : page.draft}
        publishedAt={page.publishedAt}
        asked={query.product}
      />
    </div>
  );
}
