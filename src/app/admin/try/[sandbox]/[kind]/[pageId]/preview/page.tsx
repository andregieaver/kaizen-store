import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { adminText } from "@/lib/admin-text";
import { sandboxBase } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getPageForEdit } from "@/server/pages";

import { isPageId, sandboxAndKind } from "../../../editor";

export const metadata: Metadata = { title: "Preview" };

/** The last saved draft of a sandbox's page, header or footer, drawn as its store would show it (D457), as a store's own *Preview* does. */
export default async function SandboxPreviewPage({ params }: PageProps<"/admin/try/[sandbox]/[kind]/[pageId]/preview">) {
  const [{ sandbox, kind }, { pageId }] = await Promise.all([sandboxAndKind(params), params]);
  if (!sandbox) return null;
  if (!isPageId(pageId)) notFound();
  const [lang, page] = await Promise.all([requestAdminLang(), getPageForEdit(sandbox.store.id, pageId, kind)]);
  if (!page) notFound();
  const ew = adminText(lang, "builder").editor;
  return (
    <div className="flex flex-col gap-6 pt-4">
      <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand px-4 py-3 text-sm text-brand-ink">
        <span>{ew.previewDraft}</span>
        <Link href={`${sandboxBase(sandbox.id, kind)}/${page.id}`} className="font-medium underline">
          {ew.backToEditing}
        </Link>
      </p>
      <PageDrawing store={sandbox.store} type={kind} id={page.id} content={page.draft} publishedAt={page.publishedAt} />
    </div>
  );
}
