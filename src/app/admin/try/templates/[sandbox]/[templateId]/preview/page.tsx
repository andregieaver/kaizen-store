import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { newPageContent } from "@/lib/page-content";
import { requestAdminLang } from "@/server/admin-request-lang";
import { sandboxFor } from "@/server/sandbox";
import { listTemplates, previewTemplate } from "@/server/templates";

export const metadata: Metadata = { title: "Template preview", robots: { index: false, follow: false } };

/**
 * A marketplace template shown before it is used in a sandbox (D457), for the frame in the page builder: drawn as the sandbox's store draws
 * its pages, inert and view-only, as a store's own template preview is (`/admin/account/templates/s/{store}/{id}/preview`). Opened with the
 * sandbox's pass; only a template the marketplace offers it, never one of another sandbox's saved parts.
 */
export default async function SandboxTemplatePreview({ params }: PageProps<"/admin/try/templates/[sandbox]/[templateId]/preview">) {
  const { sandbox: id, templateId } = await params;
  const sandbox = await sandboxFor(id);
  if (!sandbox || !z.uuid().safeParse(templateId).success) notFound();
  const offered = await listTemplates(sandbox.store.id, sandbox.account, "marketplace");
  if (!offered.some((template) => template.id === templateId)) notFound();
  const [lang, result] = await Promise.all([requestAdminLang(), previewTemplate(sandbox.store.id, sandbox.account, templateId)]);
  if (!result.ok) notFound();
  const { preview } = result;
  const w = adminText(lang, "sandbox").templatePreview;
  return (
    <div className="flex min-h-screen flex-col">
      <p role="status" className="sticky top-0 z-50 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-foreground px-4 py-2 text-xs text-background">
        <span className="font-medium">{w.notice}</span>
        <span>
          {preview.name} · {fillWords(w.by, { publisher: preview.publisher })}
        </span>
      </p>
      {/* Nothing in the template can be clicked, focused or submitted. */}
      <div inert className="pointer-events-none min-w-0 flex-1 select-none">
        <PageDrawing
          themed
          store={sandbox.store}
          type={preview.pageType ?? "page"}
          id={preview.id}
          content={{ ...newPageContent(), title: preview.name, rows: preview.rows, css: preview.css }}
          publishedAt={null}
        />
      </div>
    </div>
  );
}
