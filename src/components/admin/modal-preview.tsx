"use client";

import { useState } from "react";

import { PageModal } from "@/components/page-modal";
import { PageBlockView } from "@/components/page-block";
import {
  PartBackground,
  blockBox,
  columnBox,
  modalPanelStyle,
  rowBox,
  rowGrid,
  rowInnerClass,
} from "@/components/page-parts";
import { SiteForm } from "@/components/site-form";
import { publicForm } from "@/lib/forms";
import { t } from "@/lib/i18n";
import { blockHasContent, blockOwnContent, type PageBlock, type PageRow } from "@/lib/page-content";
import { modalSummary } from "@/lib/page-modal";

/**
 * A modal's row on the builder's canvas (D121): it stays in the page, where
 * it is edited as any row, outlined and badged with what opens it, and a
 * Preview button opens the real modal over the canvas, as visitors get it.
 * The preview's triggers are off: nothing opens by itself here.
 */
export function ModalBar({ row, lang }: { row: PageRow; lang: string | undefined }) {
  const [open, setOpen] = useState(false);
  const modal = row.modal;
  if (!modal) return null;
  const m = t(lang ?? "en").modal;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <span data-modal-badge>{modalSummary(modal)}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto min-h-7 rounded border border-amber-700 px-2 font-medium hover:bg-amber-200 focus-visible:outline-2 dark:hover:bg-amber-900"
        >
          Preview
        </button>
      </div>
      <PageModal
        config={modal}
        storeId={null}
        auto={false}
        labels={{ close: m.close, dialog: m.dialog }}
        panelStyle={modalPanelStyle(row)}
        preview={{ open, onClose: () => setOpen(false) }}
      >
        <PreviewRow row={{ ...row, width: undefined, contentWidth: undefined, fullHeight: undefined }} lang={lang} />
      </PageModal>
    </>
  );
}

/** The row as the panel draws it, with the components the browser can draw alone; the rest say where they show. */
function PreviewRow({ row, lang }: { row: PageRow; lang: string | undefined }) {
  const box = rowBox(row, "canvas", true);
  const grid = rowGrid(row);
  return (
    <div className={box.className} style={box.style}>
      <PartBackground background={row.background} />
      <div className={rowInnerClass(row, "canvas")}>
        <div className={grid.className} style={grid.style}>
          {row.columns.map((column) => {
            const col = columnBox(column, row, "canvas");
            return (
              <div key={column.id} className={col.className} style={col.style}>
                <PartBackground background={column.background} />
                {column.blocks.map((block) => {
                  const b = blockBox(block, "canvas");
                  return (
                    <div key={block.id} className={b.className || undefined} style={b.style}>
                      <PreviewBlock block={block} lang={lang} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PreviewBlock({ block, lang }: { block: PageBlock; lang: string | undefined }) {
  if (block.type === "emailForm" || block.type === "newsletter")
    return <SiteForm form={publicForm(block)} store={null} lang={lang} preview />;
  if (
    block.type === "contentGrid" ||
    block.type === "product" ||
    block.type === "site" ||
    block.type === "menu" ||
    block.type === "search"
  ) {
    return <p className="rounded-md bg-surface p-3 text-sm text-muted">Shown here on the site.</p>;
  }
  if (block.type === "customField" || block.type === "fieldLoop" || block.type === "storePart") {
    return <p className="rounded-md bg-surface p-3 text-sm text-muted">Shown here on the site.</p>;
  }
  return blockHasContent(block) && blockOwnContent(block) ? (
    <PageBlockView block={block} />
  ) : (
    <p className="rounded-md bg-surface p-3 text-sm text-muted">Nothing to show yet.</p>
  );
}
