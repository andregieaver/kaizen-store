"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { changedCellCount, changedEdits, figureText, fieldWords, type GridCells, type GridEditInput } from "@/lib/bulk-admin";
import type { BatchSummary, BulkProblem, GridPreview, UndoResult } from "@/server/bulk-edit";
import type { GridApplied } from "@/app/admin/(gated)/[store]/products/bulk/actions";

import { BulkResult } from "./bulk-result";
import { card, field, hint, primary, secondary, tableShell, td, th } from "./data/ui";

export type GridRowView = { productId: string; variantId: string; title: string; handle: string; options: string; active: boolean; cells: GridCells };

export type GridTools = {
  preview: (edits: GridEditInput[], markets: string[]) => Promise<GridPreview | BulkProblem>;
  apply: (edits: GridEditInput[], markets: string[]) => Promise<GridApplied>;
  undo: (batchId: string) => Promise<UndoResult>;
};

/**
 * The bulk grid (D165, `docs/wave-2-data.md` 2.6): one row for each variant, with SKU, a price for each chosen market, stock and cost as typed text. The edits
 * stay in the browser until *Review changes*, which lists every changed cell before and after, what is in conflict with the store's value now and what is
 * invalid in the editor's own words; nothing is written until *Apply*. After it, *Undo this change* puts the values back where they are still what the
 * change made them.
 */
export function ProductsGrid({ rows, markets, mainCurrency, tools, locale }: { rows: GridRowView[]; markets: { code: string; currency: string }[]; mainCurrency: string; tools: GridTools; locale: string }) {
  const router = useRouter();
  const codes = useMemo(() => markets.map((m) => m.code), [markets]);
  const [edited, setEdited] = useState<Record<string, GridCells>>(() => Object.fromEntries(rows.map((r) => [r.variantId, { ...r.cells, prices: { ...r.cells.prices } }])));
  const [preview, setPreview] = useState<GridPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: BatchSummary | null; conflicts: number; invalid: number } | null>(null);
  const [pending, start] = useTransition();

  const edits = useMemo(() => changedEdits(rows.map((r) => ({ productId: r.productId, variantId: r.variantId, loaded: r.cells })), edited), [rows, edited]);
  const cells = changedCellCount(edits);
  const currencyOf = (f: string) => (f.startsWith("price:") ? (markets.find((m) => m.code === f.slice(6))?.currency ?? null) : f === "cost" ? mainCurrency : null);

  const change = (variantId: string, patch: (c: GridCells) => GridCells) => {
    setPreview(null);
    setResult(null);
    setEdited((all) => ({ ...all, [variantId]: patch(all[variantId]) }));
  };

  const discard = () => {
    setEdited(Object.fromEntries(rows.map((r) => [r.variantId, { ...r.cells, prices: { ...r.cells.prices } }])));
    setPreview(null);
  };

  const review = () =>
    start(async () => {
      setProblem(null);
      const got = await tools.preview(edits, codes);
      if (!got.ok) return setProblem(got.problem);
      setPreview(got);
    });

  const apply = () =>
    start(async () => {
      setProblem(null);
      const got = await tools.apply(edits, codes);
      if (!got.ok) return setProblem(got.problem);
      setPreview(null);
      setResult({ summary: got.summary, conflicts: got.conflicts, invalid: got.invalid });
    });

  const cellClass = (changed: boolean) => `${field} w-full min-w-24 ${changed ? "border-foreground" : ""}`;

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <div className={tableShell}>
        <table className="w-full text-sm">
          <caption className="sr-only">One row for each variant of the chosen products. Edit a cell, then review the changes.</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className={th}>
                Product
              </th>
              <th scope="col" className={th}>
                Options
              </th>
              <th scope="col" className={th}>
                SKU
              </th>
              {markets.map((m) => (
                <th key={m.code} scope="col" className={th}>
                  Price {m.code} ({m.currency})
                </th>
              ))}
              <th scope="col" className={th}>
                Stock
              </th>
              <th scope="col" className={th}>
                Cost ({mainCurrency}, excl. VAT)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const now = edited[row.variantId];
              const was = row.cells;
              return (
                <tr key={row.variantId} className="border-b border-border last:border-0">
                  <td className={td}>
                    <span className="font-medium">{row.title}</span>
                    {!row.active && <span className={`${hint} block`}>Switched off</span>}
                  </td>
                  <td className={td}>{row.options || <span className={hint}>-</span>}</td>
                  <td className={td}>
                    <input aria-label={`SKU, ${row.title} ${row.options}`} value={now.sku} onChange={(e) => change(row.variantId, (c) => ({ ...c, sku: e.target.value }))} className={cellClass(now.sku !== was.sku)} />
                  </td>
                  {markets.map((m) => (
                    <td key={m.code} className={td}>
                      <input
                        aria-label={`Price ${m.code}, ${row.title} ${row.options}`}
                        inputMode="decimal"
                        value={now.prices[m.code] ?? ""}
                        onChange={(e) => change(row.variantId, (c) => ({ ...c, prices: { ...c.prices, [m.code]: e.target.value } }))}
                        className={cellClass((now.prices[m.code] ?? "") !== (was.prices[m.code] ?? ""))}
                      />
                    </td>
                  ))}
                  <td className={td}>
                    <input aria-label={`Stock, ${row.title} ${row.options}`} inputMode="numeric" value={now.stock} onChange={(e) => change(row.variantId, (c) => ({ ...c, stock: e.target.value }))} className={cellClass(now.stock !== was.stock)} />
                  </td>
                  <td className={td}>
                    <input aria-label={`Cost, ${row.title} ${row.options}`} inputMode="decimal" value={now.cost} onChange={(e) => change(row.variantId, (c) => ({ ...c, cost: e.target.value }))} className={cellClass(now.cost !== was.cost)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={hint}>Prices are typed as in the editor: with VAT for each country, and without VAT in a store that sells only to businesses. Every change is checked like an editor save, and a price changes only through the price history.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || edits.length === 0} onClick={review} className={primary}>
          {pending && !preview ? "Reviewing …" : `Review changes${cells > 0 ? ` (${cells})` : ""}`}
        </button>
        <button type="button" disabled={pending || edits.length === 0} onClick={discard} className={secondary}>
          Discard my edits
        </button>
        {problem && (
          <span role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </span>
        )}
      </div>

      {preview && (
        <section aria-label="Review" className={`${card} flex flex-col gap-3`}>
          <h2 className="text-base font-semibold">
            {preview.changes.length === 0 ? "Nothing would change" : `${preview.changes.length} ${preview.changes.length === 1 ? "change" : "changes"} in ${preview.products} ${preview.products === 1 ? "product" : "products"} and ${preview.variants} ${preview.variants === 1 ? "variant" : "variants"}`}
          </h2>
          {preview.changes.length > 0 && (
            <div className={tableShell}>
              <table className="w-full text-sm">
                <caption className="sr-only">Every changed cell, before and after</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className={th}>
                      Product
                    </th>
                    <th scope="col" className={th}>
                      What
                    </th>
                    <th scope="col" className={th}>
                      Before
                    </th>
                    <th scope="col" className={th}>
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.map((c, i) => (
                    <tr key={`${c.variantId}-${c.field}-${i}`} className="border-b border-border last:border-0">
                      <td className={td}>
                        {c.title}
                        {c.sku ? <span className={`${hint} block`}>{c.sku}</span> : null}
                      </td>
                      <td className={td}>{fieldWords(c.field)}</td>
                      <td className={td}>{figureText(c.field, c.before, currencyOf, locale)}</td>
                      <td className={`${td} font-medium`}>{figureText(c.field, c.after, currencyOf, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.invalid.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">Cannot be changed</h3>
              <ul className="text-sm">
                {preview.invalid.map((c, i) => (
                  <li key={`${c.variantId}-${c.field}-${i}`}>
                    {c.title}
                    {c.sku ? ` (${c.sku})` : ""}, {fieldWords(c.field).toLowerCase()}: {c.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview.conflicts.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Changed in the store since you opened this page</h3>
              <p className={hint}>These are not overwritten. Reload the page to see the current values.</p>
              <ul className="text-sm">
                {preview.conflicts.map((c, i) => (
                  <li key={`${c.variantId}-${c.field}-${i}`}>
                    {c.title}
                    {c.sku ? ` (${c.sku})` : ""}, {fieldWords(c.field).toLowerCase()}: now {figureText(c.field, c.current, currencyOf, locale)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending || preview.changes.length === 0} onClick={apply} className={primary}>
              {pending ? "Applying …" : "Apply"}
            </button>
            <button type="button" disabled={pending} onClick={() => setPreview(null)} className={secondary}>
              Keep editing
            </button>
          </div>
        </section>
      )}

      {result?.summary && (
        <BulkResult
          summary={result.summary}
          undo={tools.undo}
          onReload={() => {
            setResult(null);
            router.refresh();
          }}
        />
      )}
      {result && result.summary && (result.conflicts > 0 || result.invalid > 0) && (
        <p className={hint}>
          {result.conflicts > 0 ? `${result.conflicts} ${result.conflicts === 1 ? "cell was" : "cells were"} left as they were because the store had changed. ` : ""}
          {result.invalid > 0 ? `${result.invalid} ${result.invalid === 1 ? "cell was" : "cells were"} invalid and not written.` : ""}
        </p>
      )}
    </div>
  );
}
