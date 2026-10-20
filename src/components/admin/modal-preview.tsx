"use client";

import { useState, type ReactNode } from "react";

import { PageModal } from "@/components/page-modal";
import { PageBlockView } from "@/components/page-block";
import {
  PartBackground,
  blockBox,
  columnBox,
  modalPanelClass,
  rowBox,
  rowGrid,
  rowInnerClass,
} from "@/components/page-parts";
import { SiteForm } from "@/components/site-form";
import { publicForm } from "@/lib/forms";
import { t } from "@/lib/i18n";
import { blockHasContent, blockOwnContent, columnLines, columnsAsRow, rowShows, type ColumnsBlock, type PageBlock, type PageColumn, type PageRow } from "@/lib/page-content";
import { MODAL_LEFT_OUT, modalSummary } from "@/lib/page-modal";

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
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-warning-soft px-2 py-1 text-xs text-warning-text">
        <span data-modal-badge>{modalSummary(modal)}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto min-h-7 rounded border border-warning-text px-2 font-medium hover:bg-warning-soft focus-visible:outline-2"
        >
          Preview
        </button>
        {/* The preview below draws the form as it would look; the site leaves the row out when nothing in it shows. */}
        {!rowShows(row) && (
          <p data-modal-left-out className="basis-full font-medium">
            {MODAL_LEFT_OUT}
          </p>
        )}
      </div>
      <PageModal
        config={modal}
        storeId={null}
        auto={false}
        labels={{ close: m.close, dialog: m.dialog }}
        panelClassName={modalPanelClass(row)}
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
  const lines = columnLines(row);
  const renderColumn = (column: PageColumn, holder: PageRow = row): ReactNode => {
    const col = columnBox(column, holder, "canvas");
    return (
      <div key={column.id} className={col.className} style={col.style}>
        <PartBackground background={column.background} />
        {column.blocks.map((block) => {
          const b = blockBox(block, "canvas");
          return (
            <div key={block.id} className={b.className || undefined} style={b.style}>
              {block.type === "columns" ? <PreviewNested block={block} renderColumn={renderColumn} /> : <PreviewBlock block={block} lang={lang} />}
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className={box.className} style={box.style}>
      <PartBackground background={row.background} />
      <div className={rowInnerClass(row, "canvas")}>
        <div className={grid.className} style={grid.style}>
          {lines.length === 1
            ? row.columns.map((column) => renderColumn(column))
            : lines.map((line, l) => <div key={line[0]?.id ?? l}>{line.map((column) => renderColumn(column))}</div>)}
        </div>
      </div>
    </div>
  );
}

/** A Columns component (D294) in the panel: its lines of columns as a row's. */
function PreviewNested({ block, renderColumn }: { block: ColumnsBlock; renderColumn: (column: PageColumn, holder: PageRow) => ReactNode }) {
  const holder = columnsAsRow(block);
  const grid = rowGrid(holder);
  const lines = columnLines(holder);
  return (
    <div className={grid.className} style={grid.style}>
      {lines.length === 1
        ? holder.columns.map((column) => renderColumn(column, holder))
        : lines.map((line, l) => <div key={line[0]?.id ?? l}>{line.map((column) => renderColumn(column, holder))}</div>)}
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
    return <p className="rounded-md bg-sunken p-3 text-sm text-muted">Shown here on the site.</p>;
  }
  if (block.type === "customField" || block.type === "fieldLoop" || block.type === "storePart") {
    return <p className="rounded-md bg-sunken p-3 text-sm text-muted">Shown here on the site.</p>;
  }
  return blockHasContent(block) && blockOwnContent(block) ? (
    <PageBlockView block={block} />
  ) : (
    <p className="rounded-md bg-sunken p-3 text-sm text-muted">Nothing to show yet.</p>
  );
}
