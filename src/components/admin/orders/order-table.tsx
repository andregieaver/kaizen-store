"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";

import type { BulkActionResponse } from "@/app/admin/(gated)/[store]/orders/list-actions";
import { field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { bulkSummary, groupRefusals, notifyText, type BulkResult } from "@/lib/order-bulk";
import { selectionBanner, printHref } from "@/lib/order-list-admin";
import { BULK_MAX, BULK_PRINT_MAX } from "@/lib/order-limits";
import { COLUMN_LABELS, type OrderColumn } from "@/lib/order-list";
import { PAY_CELL_LABELS, SHIP_CELL_LABELS, type OrderListItem } from "@/lib/order-list-row";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { SOURCE_LABELS } from "@/lib/order-list";

/** A row with the words the server already worked out (the date in the store's own time zone, the total in its currency), so the page draws the same on the server and in the browser. */
export type OrderTableRow = OrderListItem & { placedText: string; totalText: string };

export type OrderTableProps = {
  slug: string;
  rows: OrderTableRow[];
  columns: readonly OrderColumn[];
  /** How many orders match the list (up to the cap), and whether there are more. */
  matching: number;
  capped: boolean;
  /** The list's own query, for "select all matching": the server reads it again, the browser never sends ids it was not shown. */
  matchingQuery: string;
  canWrite: boolean;
  /** The store's tags in use, as suggestions. */
  suggestions: string[];
  /** The bound server action of the bulk bar. */
  bulk: (request: { action: string; ids?: string[]; matchingQuery?: string; tags?: string[]; notify?: boolean }) => Promise<BulkActionResponse>;
};

type Pending = "add_tags" | "remove_tags" | "archive" | "unarchive" | "mark_sent";

const badge = "ml-2 inline-block rounded-full border border-border px-2 py-0.5 align-middle text-xs font-normal text-muted";

/**
 * The Orders page's table with its selection and bulk bar (wave 3, D173, `docs/wave-3-orders.md` 2.2.3 and 2.2.5). A tick box on every row (staff who may only read see none), *Select all
 * on this page*, and, when every row is ticked and no more than 250 orders match, *Select all {n} matching*. The bar offers tags, archive, unarchive, mark as sent (asks first, and
 * says how many customers will be emailed when that is on) and print. After an action the panel says "Applied to 41 of 43 orders" and lists each refusal with its reason.
 */
export function OrderTable({ slug, rows, columns, matching, capped, matchingQuery, canWrite, suggestions, bulk }: OrderTableProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [tagText, setTagText] = useState("");
  const [notify, setNotify] = useState(false);
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [working, startTransition] = useTransition();
  const listId = useId();
  const headerId = useId();

  const selectedCount = allMatching ? matching : ticked.size;
  const banner = selectionBanner({ pageRows: rows.length, ticked: ticked.size, matching, capped, allMatching });
  const allTicked = rows.length > 0 && ticked.size === rows.length;
  const selectedRows = useMemo(() => rows.filter((r) => ticked.has(r.id)), [rows, ticked]);
  // Mark as sent tells a customer only when the order is sent and has an address to tell.
  const emails = selectedRows.filter((r) => r.ship === "to_send" && r.email !== null).length;
  const printable = !allMatching && ticked.size > 0 && ticked.size <= BULK_PRINT_MAX;

  const toggle = (id: string) => {
    setAllMatching(false);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setAllMatching(false);
    setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const clear = () => {
    setAllMatching(false);
    setTicked(new Set());
    setConfirming(null);
  };

  const run = (action: Pending) => {
    setProblem(null);
    setResult(null);
    const tags = action === "add_tags" || action === "remove_tags" ? tagText.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    if (tags && tags.length === 0) {
      setProblem("Write at least one tag.");
      return;
    }
    startTransition(async () => {
      const answer = await bulk({
        action,
        ...(allMatching ? { matchingQuery } : { ids: [...ticked] }),
        ...(tags ? { tags } : {}),
        ...(action === "mark_sent" ? { notify } : {}),
      });
      setConfirming(null);
      if (!answer.ok) {
        setProblem(answer.message);
        return;
      }
      setResult(answer.result);
      setTicked(new Set());
      setAllMatching(false);
      if (tags) setTagText("");
    });
  };

  const col = (c: OrderColumn) => columns.includes(c);

  return (
    <div className="flex flex-col gap-3">
      {result && <ResultPanel result={result} onClose={() => setResult(null)} />}
      {problem && (
        <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}

      {canWrite && selectedCount > 0 && (
        <section aria-label="Bulk actions" className="flex flex-col gap-3 rounded-lg border border-foreground bg-surface p-3" aria-busy={working}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <strong>
              {selectedCount.toLocaleString("en")} {selectedCount === 1 ? "order" : "orders"} selected
            </strong>
            <button type="button" onClick={clear} className="underline underline-offset-2">
              Clear selection
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${listId}-tags`} className="text-xs font-medium">
                Tags <span className="font-normal text-muted">(separate with commas)</span>
              </label>
              <input
                id={`${listId}-tags`}
                list={`${listId}-suggestions`}
                value={tagText}
                onChange={(event) => setTagText(event.target.value)}
                maxLength={400}
                autoComplete="off"
                className={`${field} w-56`}
              />
              <datalist id={`${listId}-suggestions`}>
                {suggestions.map((label) => (
                  <option key={label} value={label} />
                ))}
              </datalist>
            </div>
            <button type="button" disabled={working} onClick={() => run("add_tags")} className={secondary}>
              Add tags
            </button>
            <button type="button" disabled={working} onClick={() => run("remove_tags")} className={secondary}>
              Remove tags
            </button>
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <button type="button" disabled={working} onClick={() => run("archive")} className={secondary}>
              Archive
            </button>
            <button type="button" disabled={working} onClick={() => run("unarchive")} className={secondary}>
              Unarchive
            </button>
            <button type="button" disabled={working} onClick={() => setConfirming(confirming === "mark_sent" ? null : "mark_sent")} className={secondary} aria-expanded={confirming === "mark_sent"}>
              Mark as sent
            </button>
            {printable ? (
              <Link href={printHref(slug, [...ticked])} target="_blank" className={secondary}>
                Print packing slips
              </Link>
            ) : (
              <span className="text-xs text-muted">
                {allMatching ? "Printing works on the orders ticked on a page." : `Tick at most ${BULK_PRINT_MAX} orders to print their packing slips.`}
              </span>
            )}
          </div>
          {confirming === "mark_sent" && (
            <div role="group" aria-label="Confirm mark as sent" className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm">
              <p>
                Mark {selectedCount.toLocaleString("en")} {selectedCount === 1 ? "order" : "orders"} as sent, without a tracking number. Orders that are not paid, have nothing to ship, are copied history, wait for stock or were
                already sent are skipped and listed afterwards.
              </p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="size-4" />
                Tell the customers
              </label>
              <p className={hint} aria-live="polite">
                {notify ? (allMatching ? "Each customer whose order is sent gets an email." : notifyText(emails)) : "No emails are sent."}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={working} onClick={() => run("mark_sent")} className={primary}>
                  {working ? "Working …" : "Mark as sent"}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p className={hint}>
            At most {BULK_MAX} orders at a time. Each order is handled on its own: one that cannot be changed is listed afterwards and does not stop the others.
          </p>
        </section>
      )}

      {canWrite && banner.kind === "offer" && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm" role="status">
          All {rows.length} orders on this page are selected.{" "}
          <button type="button" onClick={() => setAllMatching(true)} className="underline underline-offset-2">
            Select all {banner.matching.toLocaleString("en")} matching
          </button>
        </p>
      )}
      {canWrite && banner.kind === "too_many" && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm" role="status">
          All {rows.length} orders on this page are selected. More than {BULK_MAX} orders match, which is more than one batch takes: narrow the list to act on all of them.
        </p>
      )}
      {canWrite && banner.kind === "all_matching" && (
        <p className="rounded-lg border border-border bg-surface p-3 text-sm" role="status">
          All {banner.matching.toLocaleString("en")} matching orders are selected.{" "}
          <button type="button" onClick={clear} className="underline underline-offset-2">
            Clear selection
          </button>
        </p>
      )}

      <div className={tableShell}>
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              {canWrite && (
                <th scope="col" className={`${th} w-10`}>
                  <input id={headerId} type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Select all orders on this page" className="size-4" />
                </th>
              )}
              <th scope="col" className={th}>
                Order
              </th>
              {col("placed") && (
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  {COLUMN_LABELS.placed}
                </th>
              )}
              {col("customer") && (
                <th scope="col" className={th}>
                  {COLUMN_LABELS.customer}
                </th>
              )}
              {col("market") && (
                <th scope="col" className={th}>
                  {COLUMN_LABELS.market}
                </th>
              )}
              {col("payment") && (
                <th scope="col" className={th}>
                  {COLUMN_LABELS.payment}
                </th>
              )}
              {col("fulfilment") && (
                <th scope="col" className={th}>
                  {COLUMN_LABELS.fulfilment}
                </th>
              )}
              {col("items") && (
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  {COLUMN_LABELS.items}
                </th>
              )}
              {col("tags") && (
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  {COLUMN_LABELS.tags}
                </th>
              )}
              {col("source") && (
                <th scope="col" className={th}>
                  {COLUMN_LABELS.source}
                </th>
              )}
              {col("total") && (
                <th scope="col" className={`${th} text-right`}>
                  {COLUMN_LABELS.total}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OrderRow key={row.id} row={row} slug={slug} columns={columns} canWrite={canWrite} ticked={ticked.has(row.id) || allMatching} onToggle={() => toggle(row.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderRow({ row, slug, columns, canWrite, ticked, onToggle }: { row: OrderTableRow; slug: string; columns: readonly OrderColumn[]; canWrite: boolean; ticked: boolean; onToggle: () => void }) {
  const col = (c: OrderColumn) => columns.includes(c);
  const base = `/admin/${slug}`;
  return (
    <tr className="border-b border-border last:border-0">
      {canWrite && (
        <td className={td}>
          <input type="checkbox" checked={ticked} onChange={onToggle} aria-label={`Select order ${row.number}`} className="size-4" />
        </td>
      )}
      <td className={td}>
        <Link href={`${base}/orders/${row.id}`} className="font-medium underline-offset-2 hover:underline">
          #{row.number}
        </Link>
        {row.archived && <span className={badge}>Archived</span>}
        {row.gift && <span className={badge}>Gift</span>}
        {row.source === "draft" && <span className={badge}>{row.draftNumber ? `Staff-made ${row.draftNumber}` : "Staff-made"}</span>}
        {row.owed > 0 && <span className={badge}>Waiting for stock</span>}
        {row.copied && <span className={badge}>Copied</span>}
        {row.erased && <span className={badge}>Personal data erased</span>}
      </td>
      {col("placed") && (
        <td className={`${td} hidden sm:table-cell`}>
          <time dateTime={row.placedAt}>{row.placedText}</time>
        </td>
      )}
      {col("customer") && (
        <td className={td}>
          {row.erased ? (
            <span className="text-muted">Erased</span>
          ) : row.email ? (
            <Link href={`${base}/customers/${row.id}`} className="underline-offset-2 hover:underline">
              {row.name || row.email}
            </Link>
          ) : (
            "–"
          )}
        </td>
      )}
      {col("market") && <td className={td}>{row.marketCode}</td>}
      {col("payment") && <td className={td}>{PAY_CELL_LABELS[row.pay]}</td>}
      {col("fulfilment") && (
        <td className={td}>
          {row.ship === "none" ? (row.status === "pending_payment" ? "–" : ORDER_STATUS_LABELS[row.status]) : SHIP_CELL_LABELS[row.ship]}
          {row.owed > 0 && (
            <span className="block text-xs">
              {row.owed} {row.owed === 1 ? "unit" : "units"} owed
            </span>
          )}
        </td>
      )}
      {col("items") && (
        <td className={`${td} hidden md:table-cell`}>
          {row.items} {row.items === 1 ? "item" : "items"}
        </td>
      )}
      {col("tags") && (
        <td className={`${td} hidden md:table-cell`}>
          {row.tags.length === 0 ? (
            <span className="text-muted">–</span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {row.tags.map((tag) => (
                <li key={tag.key} className="rounded-full border border-border px-2 py-0.5 text-xs">
                  {tag.label}
                </li>
              ))}
            </ul>
          )}
        </td>
      )}
      {col("source") && <td className={td}>{row.copied ? SOURCE_LABELS.copied : row.source === "draft" ? SOURCE_LABELS.draft : SOURCE_LABELS.checkout}</td>}
      {col("total") && <td className={`${td} text-right tabular-nums`}>{row.totalText}</td>}
    </tr>
  );
}

/** What a bulk action did: "Applied to 41 of 43 orders", the emails sent, and each refusal grouped by its reason with the orders it was for. */
export function ResultPanel({ result, onClose }: { result: BulkResult; onClose?: () => void }) {
  const groups = groupRefusals(result.refused);
  return (
    <section aria-label="Result of the bulk action" role="status" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{bulkSummary(result)}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs underline underline-offset-2">
            Close
          </button>
        )}
      </div>
      {result.emailed !== undefined && (
        <p>
          {result.emailed} {result.emailed === 1 ? "customer was" : "customers were"} emailed.
        </p>
      )}
      {groups.length > 0 && (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.reason}>
              <span className="font-medium">
                {group.orders.length} {group.orders.length === 1 ? "order" : "orders"} not changed:
              </span>{" "}
              {group.text}{" "}
              <span className="text-muted">
                {group.orders.length > 12
                  ? `${group.orders.slice(0, 12).map(refusedName).join(", ")} and ${group.orders.length - 12} more`
                  : group.orders.map(refusedName).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const refusedName = (r: { number: string | null }) => (r.number ? `#${r.number}` : "an order that was not found");
