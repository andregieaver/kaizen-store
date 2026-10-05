"use client";

import { useState, useTransition } from "react";

import { ACTION_WORDS, fieldWords } from "@/lib/bulk-admin";
import { BULK_UNDO_DAYS } from "@/lib/data-limits";
import type { BatchSummary, UndoResult } from "@/server/bulk-edit";

import { card, hint, primary, secondary } from "./data/ui";

/** The failures of a batch, each with the product (title, else handle), its SKU and the reason in the editor's own words. */
export function BulkFailures({ failures }: { failures: BatchSummary["failures"] }) {
  if (failures.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">Not changed, and why</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {failures.map((f, i) => (
          <li key={`${f.productId}-${f.field}-${i}`} className="rounded-md border border-border bg-background px-3 py-2">
            <span className="font-medium">{f.title ?? f.handle ?? "A product"}</span>
            {f.sku ? <span className="text-muted"> ({f.sku})</span> : null}
            {f.field ? <span className="text-muted">, {fieldWords(f.field).toLowerCase()}</span> : null}: {f.reason}
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
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [pending, start] = useTransition();
  const c = summary.counts;
  return (
    <section aria-label="Result" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">{ACTION_WORDS[summary.action] ?? "Change"}: done</h2>
      <p className="text-sm">
        {c.products} {c.products === 1 ? "product" : "products"}: {c.changed} changed, {c.unchanged} left as they were, {c.failed} failed.
      </p>
      <BulkFailures failures={summary.failures} />
      {undone?.ok === true && (
        <p role="status" className="text-sm">
          Put back {undone.restored} {undone.restored === 1 ? "change" : "changes"}.
          {undone.conflicts + undone.gone > 0 ? ` ${undone.conflicts + undone.gone} left as they are, because they changed after this edit or no longer exist.` : ""}
        </p>
      )}
      {undone?.ok === false && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
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
            {pending ? "Undoing …" : "Undo this change"}
          </button>
        )}
        {onReload && (
          <button type="button" className={primary} onClick={onReload}>
            Done
          </button>
        )}
      </div>
      {summary.undoable && !undone?.ok && <p className={hint}>You can undo this change for {BULK_UNDO_DAYS} days. A price that is put back is a new price in the history, as any price change is.</p>}
    </section>
  );
}

export type RecentBatch = { summary: BatchSummary; when: string };

/** The store's recent bulk changes, newest first: what each did, to how many products, and *Undo* for the ones still inside the seven days. */
export function RecentBatches({ batches, undo }: { batches: RecentBatch[]; undo: (batchId: string) => Promise<UndoResult> }) {
  const [done, setDone] = useState<Record<string, UndoResult>>({});
  const [pending, start] = useTransition();
  if (batches.length === 0) return <p className="text-sm text-muted">No bulk changes yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">Recent bulk changes, newest first</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              When
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Change
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Result
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              <span className="sr-only">Undo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {batches.map(({ summary, when }) => {
            const outcome = done[summary.id];
            const c = summary.counts;
            return (
              <tr key={summary.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 align-top">{when}</td>
                <td className="px-3 py-2 align-top">{ACTION_WORDS[summary.action] ?? summary.action}</td>
                <td className="px-3 py-2 align-top">
                  {c.changed} changed, {c.unchanged} unchanged, {c.failed} failed
                  {summary.undoneAt ? <span className="block text-xs text-muted">Undone</span> : null}
                  {outcome?.ok === false ? <span role="alert" className="block text-xs text-red-700 dark:text-red-400">{outcome.problem}</span> : null}
                  {outcome?.ok === true ? <span role="status" className="block text-xs text-muted">Put back {outcome.restored}; {outcome.conflicts + outcome.gone} left as they are.</span> : null}
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
                      Undo
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
