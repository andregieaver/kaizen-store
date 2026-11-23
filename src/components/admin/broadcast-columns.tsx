"use client";

import type { ReactNode } from "react";

import type { BroadcastBlock, BroadcastCell } from "@/lib/broadcasts-schema";
import { CELL_TEXT_MAX, CELLS_MAX } from "@/lib/broadcasts";

import { useAdminText } from "./admin-text";
import { Button } from "./ui/button";

type Columns = Extract<BroadcastBlock, { type: "columns" }>;

export const emptyCell = (): BroadcastCell => ({ image: null, alt: "", heading: "", text: "", buttonText: "", buttonUrl: "" });

/**
 * A columns block's cells in a broadcast's editor (email plan M4.1): side by side as the email shows them on a computer, each with its
 * picture, heading, words and button; a third column can be added and one taken away down to two. The picture is chosen with the editor's
 * own upload (`picture`), so it comes from the store's media library like any picture in an email.
 */
export function ColumnsFields({
  block,
  index,
  field,
  onChange,
  picture,
}: {
  block: Columns;
  index: number;
  field: string;
  onChange: (b: Columns) => void;
  picture: (has: boolean, onUploaded: (url: string) => void) => ReactNode;
}) {
  const we = useAdminText("marketing").email;
  const set = (cell: number, change: Partial<BroadcastCell>) => onChange({ ...block, cells: block.cells.map((c, j) => (j === cell ? { ...c, ...change } : c)) });
  const id = (cell: number, name: string) => `block-${index}-${cell}-${name}`;
  return (
    <div className="flex flex-col gap-3" data-columns-block>
      <div className={`grid gap-3 ${block.cells.length === 3 ? "lg:grid-cols-3" : "sm:grid-cols-2"}`}>
        {block.cells.map((c, cell) => (
          <fieldset key={cell} className="flex flex-col gap-2 rounded-md border border-line p-3">
            <legend className="px-1 text-caption text-ink-2">{we.column.replace("{n}", String(cell + 1))}</legend>
            {c.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- the email's own picture, shown as it will be sent
              <img src={c.image} alt="" className="max-h-32 w-auto self-start rounded-panel" />
            ) : null}
            {picture(Boolean(c.image), (url) => set(cell, { image: url }))}
            {c.image && (
              <input aria-label={we.alt} placeholder={we.alt} value={c.alt} maxLength={200} onChange={(e) => set(cell, { alt: e.target.value })} className={field} />
            )}
            <input id={id(cell, "heading")} aria-label={we.blocks.heading} placeholder={we.blocks.heading} value={c.heading} maxLength={150} onChange={(e) => set(cell, { heading: e.target.value })} className={field} />
            <textarea aria-label={we.blocks.paragraph} placeholder={we.blocks.paragraph} value={c.text} maxLength={CELL_TEXT_MAX} rows={3} onChange={(e) => set(cell, { text: e.target.value })} className={`${field} py-2`} />
            <input aria-label={we.buttonWords} placeholder={we.buttonWords} value={c.buttonText} maxLength={60} onChange={(e) => set(cell, { buttonText: e.target.value })} className={field} />
            {(c.buttonText || c.buttonUrl) && (
              <input aria-label={we.buttonUrl} placeholder={we.buttonUrl} value={c.buttonUrl} maxLength={500} onChange={(e) => set(cell, { buttonUrl: e.target.value })} className={field} />
            )}
            {block.cells.length > 2 && (
              <Button size="dense" kind="quiet" onClick={() => onChange({ ...block, cells: block.cells.filter((_, j) => j !== cell) })}>
                {we.removeColumn}
              </Button>
            )}
          </fieldset>
        ))}
      </div>
      {block.cells.length < CELLS_MAX && (
        <Button size="dense" onClick={() => onChange({ ...block, cells: [...block.cells, emptyCell()] })}>
          {we.addColumn}
        </Button>
      )}
    </div>
  );
}
