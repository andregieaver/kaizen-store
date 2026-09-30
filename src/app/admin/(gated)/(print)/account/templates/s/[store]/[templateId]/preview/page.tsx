import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageDrawing } from "@/app/admin/(gated)/[store]/pages/drawing";
import { newPageContent } from "@/lib/page-content";
import { LAYOUT_TYPE_LABELS } from "@/lib/page-layout";
import { KIND_LABELS } from "@/lib/templates";
import { requireMember } from "@/server/auth";
import { previewTemplate } from "@/server/templates";

export const metadata: Metadata = { title: "Template preview", robots: { index: false, follow: false } };

/**
 * A template shown before it is switched on or used (D127): what a use would place, drawn as the store's own pages
 * are (its theme, fonts and CSS, in its first country), for a frame in the page builder and without the admin around
 * it (the route group `(print)` has no store layout; the gated layout above it still checks the session). It is
 * view-only: nothing is copied or saved, its pictures are still the publisher's, and the content is inert (no
 * clicks, no focus), so no link or form on it does anything. It follows the width of the frame, so a narrow frame
 * shows the phone's layout. A page layout is drawn as its kind of page: a header and footer with the store's own
 * details, a product layout with one of its products, an article under its heading; rows, columns and components as
 * a page.
 */
export default async function TemplatePreviewPage({
  params,
}: PageProps<"/admin/account/templates/s/[store]/[templateId]/preview">) {
  const { store: slug, templateId } = await params;
  const { store, account } = await requireMember(slug);
  const result = await previewTemplate(store.id, account, templateId);
  if (!result.ok) notFound();
  const { preview } = result;
  const what =
    preview.kind === "page" && preview.pageType
      ? `${KIND_LABELS.page.one} for ${LAYOUT_TYPE_LABELS[preview.pageType].many}`
      : KIND_LABELS[preview.kind].one;
  return (
    <div className="flex min-h-screen flex-col">
      <p
        role="status"
        className="sticky top-0 z-50 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-foreground px-4 py-2 text-xs text-background"
      >
        <span className="font-medium">Preview — nothing is saved or copied</span>
        <span>
          {preview.name} · {what} · by {preview.publisher}
        </span>
      </p>
      {/* Nothing in the template can be clicked, focused or submitted. */}
      <div inert className="pointer-events-none min-w-0 flex-1 select-none">
        <PageDrawing
          themed
          store={store}
          type={preview.pageType ?? "page"}
          id={preview.id}
          content={{ ...newPageContent(), title: preview.name, rows: preview.rows, css: preview.css }}
          publishedAt={null}
        />
      </div>
    </div>
  );
}
