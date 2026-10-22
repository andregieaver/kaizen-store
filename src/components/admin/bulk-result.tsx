"use client";

import { useState, useTransition } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { actionWords, fieldWords } from "@/lib/bulk-admin";
import { BULK_UNDO_DAYS } from "@/lib/data-limits";
import type { BatchSummary, UndoResult } from "@/server/bulk-edit";

import { useAdminText } from "./admin-text";
import { card, hint, primary, secondary } from "./data/ui";

/** The failures of a batch, each with the product (title, else handle), its SKU and the reason in the editor's own words. */
export function BulkFailures({ failures }: { failures: BatchSummary["failures"] }) {
  const all = useAdminText("products");
  if (failures.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-body-strong text-ink">{all.result.failures}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {failures.map((f, i) => (
          <li key={`${f.productId}-${f.field}-${i}`} className="rounded-md border border-line bg-card px-3 py-2">
            <span className="font-medium">{f.title ?? f.handle ?? all.result.aProduct}</span>
            {f.sku ? <span className="text-muted"> ({f.sku})</span> : null}
            {f.field ? <span className="text-muted">, {fieldWords(f.field, all.bulkLib).toLowerCase()}</span> : null}: {f.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The result of a bulk change (2.6): how many products were changed, left as they were and failed, every failure with its reason, and, for seven days,
 * *Undo this change*. An undo puts back only the values that are still what the change made them, and says how many it left. Presentational but for the
 * undo button; `undo` is the page's bound action.
 */
export function BulkResult({ summary, undo, onReload }: { summary: BatchSummary; undo: (batchId: string) => Promise<UndoResult>; onReload?: () => void }) {
  const all = useAdminText("products");
  const w = all.result;
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [pending, start] = useTransition();
  const c = summary.counts;
  return (
    <section aria-label={w.label} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{fillWords(w.done, { action: (all.bulkLib.actions as Record<string, string>)[summary.action] ?? w.change })}</h2>
      <p className="text-sm">
        {countWords(c.products, w.counts, { changed: c.changed, unchanged: c.unchanged, failed: c.failed })}
      </p>
      <BulkFailures failures={summary.failures} />
      {undone?.ok === true && (
        <p role="status" className="text-sm">
          {countWords(undone.restored, w.putBack)}
          {undone.conflicts + undone.gone > 0 ? fillWords(w.leftAsThey, { n: undone.conflicts + undone.gone }) : ""}
        </p>
      )}
      {undone?.ok === false && (
        <p role="alert" className="text-sm text-danger-text">
          {undone.problem}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {summary.undoable && !undone?.ok && (
          <button
            type="button"
            disabled={pending}
            className={secondary}
            onClick={() =>
              start(async () => {
                setUndone(await undo(summary.id));
              })
            }
          >
            {pending ? w.undoing : w.undo}
          </button>
        )}
        {onReload && (
          <button type="button" className={primary} onClick={onReload}>
            {w.ok}
          </button>
        )}
      </div>
      {summary.undoable && !undone?.ok && <p className={hint}>{fillWords(w.undoHint, { days: BULK_UNDO_DAYS })}</p>}
    </section>
  );
}

export type RecentBatch = { summary: BatchSummary; when: string };

/** The store's recent bulk changes, newest first: what each did, to how many products, and *Undo* for the ones still inside the seven days. */
export function RecentBatches({ batches, undo }: { batches: RecentBatch[]; undo: (batchId: string) => Promise<UndoResult> }) {
  const all = useAdminText("products");
  const w = all.recent;
  const [done, setDone] = useState<Record<string, UndoResult>>({});
  const [pending, start] = useTransition();
  if (batches.length === 0) return <p className="text-sm text-muted">{w.none}</p>;
  return (
    <div className="overflow-x-auto rounded-panel bg-sunken">
      <table className="w-full text-sm">
        <caption className="sr-only">{w.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {w.when}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {w.change}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              {w.result}
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">{w.undo}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map(({ summary, when }) => {
            const outcome = done[summary.id];
            const c = summary.counts;
            return (
              <tr key={summary.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2 align-top">{when}</td>
                <td className="px-3 py-2 align-top">{actionWords(summary.action, all.bulkLib)}</td>
                <td className="px-3 py-2 align-top">
                  {fillWords(w.counts, { changed: c.changed, unchanged: c.unchanged, failed: c.failed })}
                  {summary.undoneAt ? <span className="block text-xs text-muted">{w.undone}</span> : null}
                  {outcome?.ok === false ? <span role="alert" className="block text-xs text-danger-text">{outcome.problem}</span> : null}
                  {outcome?.ok === true ? <span role="status" className="block text-xs text-muted">{fillWords(w.putBack, { restored: outcome.restored, left: outcome.conflicts + outcome.gone })}</span> : null}
                </td>
                <td className="px-3 py-2 align-top text-right">
                  {summary.undoable && !outcome?.ok && (
                    <button
                      type="button"
                      disabled={pending}
                      className={secondary}
                      onClick={() =>
                        start(async () => {
                          const result = await undo(summary.id);
                          setDone((d) => ({ ...d, [summary.id]: result }));
                        })
                      }
                    >
                      {w.undo}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
