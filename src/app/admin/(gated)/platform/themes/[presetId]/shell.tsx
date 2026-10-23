import Link from "next/link";
import type { ReactNode } from "react";

import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { PreviewLink } from "@/components/admin/preview-link";
import { DESIGN_TABS, designPreviewPath, designTabHref, type DesignRow, type DesignTab } from "@/lib/design-presets";
import type { LifecycleFacts } from "@/lib/lifecycle";
import { shownDesignDetails } from "@/server/design-presets";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminTexts } from "@/lib/admin-text";
import { PLATFORM_SITE_AREAS, platformSiteWords } from "@/server/platform-site-words";

import { archiveDesignAction, deleteDesignAction, publishDesignAction, unarchiveDesignAction, unpublishDesignAction } from "../actions";

/**
 * A design profile's own pages (D177): its title and state, Publish / Unpublish / Archive / Restore / Delete, the previews (as published,
 * and the draft), and the tabs where its whole look is edited (details, theme, header, footer, product page, CSS). Each page checks the
 * platform admin itself before it draws this.
 */
export async function DesignShell({
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
  const { lang, w } = await platformSiteWords();
  const s = w.shell;
  return (
    <AdminTextScope texts={adminTexts(lang, PLATFORM_SITE_AREAS)}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: facts.archivedAt ? "/admin/platform/themes?show=archived" : "/admin/platform/themes", label: s.back }}
        title={shown.title}
        status={<LifecycleBadge facts={facts} words={w.lifecycle} />}
        meta={[
          design.publishedAt ? fillWords(s.lastPublished, { date: design.publishedAt.slice(0, 10) }) : s.neverPublished,
          countWords(design.storesUsing, s.applied),
          design.requests > 0 && countWords(design.requests, s.chosen),
          design.recommendedBy.length > 0 && fillWords(s.recommended, { names: design.recommendedBy.join(", ") }),
        ]}
        description={
          facts.changed && facts.publishedAt ? s.changed : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <PreviewLink href={designPreviewPath(design.id, null, true)} label={design.published ? w.preview.asPublished : w.preview.preview} title={shown.title} of={w.preview.of} />
        {design.workspaceStoreId && <PreviewLink href={designPreviewPath(design.id, null, true, true)} label={w.preview.draft} title={shown.title} of={w.preview.of} />}
        <LifecycleButtons
          kind="theme"
          title={shown.title}
          facts={facts}
          words={w.lifecycle}
          actions={{
            publish: publishDesignAction.bind(null, design.id),
            unpublish: unpublishDesignAction.bind(null, design.id),
            archive: archiveDesignAction.bind(null, design.id),
            restore: unarchiveDesignAction.bind(null, design.id),
            remove: deleteDesignAction.bind(null, design.id),
          }}
        />
      </div>
      <nav aria-label={s.tabs} className="-mb-2 flex flex-wrap gap-1 border-b border-line">
        {DESIGN_TABS.map((item) => (
          <Link
            key={item.key}
            href={designTabHref(design.id, item.key)}
            aria-current={item.key === tab ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium"
          >
            {s.tabLabels[item.key]}
          </Link>
        ))}
      </nav>
      {children}
    </div>
    </AdminTextScope>
  );
}
