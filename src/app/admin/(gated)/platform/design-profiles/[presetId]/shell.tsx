import Link from "next/link";
import type { ReactNode } from "react";

import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { DESIGN_TABS, designPreviewPath, designTabHref, type DesignRow, type DesignTab } from "@/lib/design-presets";
import type { LifecycleFacts } from "@/lib/lifecycle";
import { shownDesignDetails } from "@/server/design-presets";

import { archiveDesignAction, deleteDesignAction, publishDesignAction, unarchiveDesignAction, unpublishDesignAction } from "../actions";

/**
 * A design profile's own pages (D177): its title and state, Publish / Unpublish / Archive / Restore / Delete, the previews (as published,
 * and the draft), and the tabs where its whole look is edited (details, theme, header, footer, product page, CSS). Each page checks the
 * platform admin itself before it draws this.
 */
export function DesignShell({
  design,
  facts,
  tab,
  children,
}: {
  design: DesignRow;
  facts: LifecycleFacts & { used: boolean };
  tab: DesignTab;
  children: ReactNode;
}) {
  const shown = shownDesignDetails(design);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={facts.archivedAt ? "/admin/platform/design-profiles?show=archived" : "/admin/platform/design-profiles"} className="w-fit text-sm underline underline-offset-2">
          Design profiles
        </Link>
        <h1 className="text-2xl font-semibold">
          {shown.title}
          <LifecycleBadge facts={facts} />
        </h1>
        <p className="text-sm text-muted">
          {design.publishedAt ? `Last published ${design.publishedAt.slice(0, 10)}` : "Never published"} · applied to {design.storesUsing}{" "}
          {design.storesUsing === 1 ? "store" : "stores"}
          {design.requests > 0 && ` · chosen on ${design.requests} ${design.requests === 1 ? "access request" : "access requests"}`}
          {design.recommendedBy.length > 0 && ` · recommended by ${design.recommendedBy.join(", ")}`}
        </p>
        {facts.changed && facts.publishedAt && (
          <p className="text-sm">Unpublished changes: stores get them when you publish. Until then they apply the profile as last published.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PreviewLink href={designPreviewPath(design.id, null, true)} label={design.published ? "Preview as published" : "Preview"} title={shown.title} />
        {design.workspaceStoreId && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label="Preview the draft" title={shown.title} />}
        <LifecycleButtons
          kind="design profile"
          title={shown.title}
          facts={facts}
          actions={{
            publish: publishDesignAction.bind(null, design.id),
            unpublish: unpublishDesignAction.bind(null, design.id),
            archive: archiveDesignAction.bind(null, design.id),
            restore: unarchiveDesignAction.bind(null, design.id),
            remove: deleteDesignAction.bind(null, design.id),
          }}
        />
      </div>
      <nav aria-label="Edit the design profile" className="-mb-2 flex flex-wrap gap-1 border-b border-border">
        {DESIGN_TABS.map((item) => (
          <Link
            key={item.key}
            href={designTabHref(design.id, item.key)}
            aria-current={item.key === tab ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
