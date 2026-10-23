import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LAYOUT_TYPE_LABELS } from "@/lib/page-layout";
import { KIND_LABELS, SHARING_LABELS } from "@/lib/templates";
import { requirePlatformAdmin } from "@/server/auth";
import { listMarketplaceTemplates } from "@/server/templates";
import { PageHeader } from "@/components/admin/ui";

import { setTemplateHiddenAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Templates" };

/**
 * The marketplace's templates (D125): what store owners share with every other store, and Kaizen's own saved parts,
 * which are its first listing. A platform admin can hide one from every list and show it again; copies stores have
 * made stay.
 */
export default async function PlatformTemplatesPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { w } = await platformSiteWords();
  const templates = await listMarketplaceTemplates();
  const hidden = templates.filter((t) => t.hidden).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.misc.templates.title}
        description={w.misc.templates.description}
      />
      <p className="text-sm text-muted">
        {templates.length === 0
          ? "Nothing is shared yet."
          : `${templates.length} ${templates.length === 1 ? "template" : "templates"}${hidden > 0 ? `, ${hidden} hidden` : ""}.`}
      </p>
      <ul className="flex flex-col gap-3">
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="font-medium">
                {template.name}
                {template.hidden && (
                  <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal">{w.misc.templates.hidden}</span>
                )}
              </span>
              <span className="text-muted">
                {KIND_LABELS[template.kind].one}
                {template.pageType ? ` for ${LAYOUT_TYPE_LABELS[template.pageType].many}` : ""}: {template.summary}
              </span>
              <span className="text-muted">
                By {template.publisher}
                {template.storeSlug ? ` (${template.storeSlug})` : ""} · {SHARING_LABELS[template.sharing].label} ·
                updated {new Date(template.updatedAt).toLocaleDateString("en-GB")}
              </span>
            </div>
            <ActionForm action={setTemplateHiddenAction.bind(null, template.id, !template.hidden)}>
              <SubmitButton variant={template.hidden ? "primary" : "secondary"}>
                {template.hidden ? "Show again" : "Hide"}
              </SubmitButton>
            </ActionForm>
          </li>
        ))}
      </ul>
    </div>
  );
}
