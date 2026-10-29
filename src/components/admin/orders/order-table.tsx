"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";

import type { BulkActionResponse } from "@/app/admin/(gated)/[store]/orders/list-actions";
import { field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ordersEn, type OrdersMessages } from "@/lib/admin-messages/orders.en";
import type { BulkResult } from "@/lib/order-bulk";
import { appliedWords, refusalGroups, shipCellWords } from "@/lib/order-list-words";
import { labelsPageHref, pickListHref, selectionBanner, printHref } from "@/lib/order-list-admin";
import { BULK_MAX, BULK_PRINT_MAX } from "@/lib/order-limits";
import type { OrderColumn } from "@/lib/order-list";
import type { DeliveryCell, OrderListItem } from "@/lib/order-list-row";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { releaseDate } from "@/lib/stock-words";

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
  /** The `orders` catalogue in the account's language (D312 A4), the order statuses' words, and the number format. */
  words?: OrdersMessages;
  statusWords?: Record<keyof typeof ORDER_STATUS_LABELS, string>;
  locale?: string;
};

type Pending = "add_tags" | "remove_tags" | "archive" | "unarchive" | "mark_sent" | "book_labels";

const badge = "ml-2 inline-block rounded-full border border-line px-2 py-0.5 align-middle text-xs font-normal text-muted";

/**
 * The Orders page's table with its selection and bulk bar (wave 3, D173, `docs/wave-3-orders.md` 2.2.3 and 2.2.5). A tick box on every row (staff who may only read see none), *Select all
 * on this page*, and, when every row is ticked and no more than 250 orders match, *Select all {n} matching*. The bar offers tags, archive, unarchive, mark as sent and book labels (D374) (each asks first, and
 * says how many customers will be emailed when that is on) and print. After an action the panel says "Applied to 41 of 43 orders" and lists each refusal with its reason.
 */
export function OrderTable({
  slug,
  rows,
  columns,
  matching,
  capped,
  matchingQuery,
  canWrite,
  suggestions,
  bulk,
  words = ordersEn,
  statusWords = ORDER_STATUS_LABELS,
  locale = "en",
}: OrderTableProps) {
  const b = words.bulk;
  const t = words.table;
  const num = (n: number) => n.toLocaleString(locale);
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
  const emails = selectedRows.filter((r) => (r.ship === "to_send" || r.ship === "partly_sent") && !r.editPending && r.email !== null).length;
  const printable = !allMatching && ticked.size > 0 && ticked.size <= BULK_PRINT_MAX;
  // Book labels (D374) takes as many orders as a printed set: its labels are printed together.
  const bookable = selectedCount > 0 && selectedCount <= BULK_PRINT_MAX;

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
      setProblem(b.writeTag);
      return;
    }
    startTransition(async () => {
      const answer = await bulk({
        action,
        ...(allMatching ? { matchingQuery } : { ids: [...ticked] }),
        ...(tags ? { tags } : {}),
        ...(action === "mark_sent" || action === "book_labels" ? { notify } : {}),
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
      {result && <ResultPanel result={result} onClose={() => setResult(null)} words={b} labelsHref={result.labels?.length ? labelsPageHref(slug, result.labels) : null} />}
      {problem && (
        <p role="alert" className="rounded-panel bg-sunken p-3 text-sm text-danger-text">
          {problem}
        </p>
      )}

      {canWrite && selectedCount > 0 && (
        <section aria-label={b.label} className="flex flex-col gap-3 rounded-lg border border-brand bg-sunken p-3" aria-busy={working}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <strong>{countWords(selectedCount, b.selected, { n: num(selectedCount) })}</strong>
            <button type="button" onClick={clear} className="underline underline-offset-2">
              {b.clear}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${listId}-tags`} className="text-xs font-medium">
                {b.tags} <span className="font-normal text-muted">{b.commas}</span>
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
              {b.actions.add_tags}
            </button>
            <button type="button" disabled={working} onClick={() => run("remove_tags")} className={secondary}>
              {b.actions.remove_tags}
            </button>
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
            <button type="button" disabled={working} onClick={() => run("archive")} className={secondary}>
              {b.actions.archive}
            </button>
            <button type="button" disabled={working} onClick={() => run("unarchive")} className={secondary}>
              {b.actions.unarchive}
            </button>
            <button type="button" disabled={working} onClick={() => setConfirming(confirming === "mark_sent" ? null : "mark_sent")} className={secondary} aria-expanded={confirming === "mark_sent"}>
              {b.actions.mark_sent}
            </button>
            {bookable ? (
              <button type="button" disabled={working} onClick={() => setConfirming(confirming === "book_labels" ? null : "book_labels")} className={secondary} aria-expanded={confirming === "book_labels"}>
                {b.actions.book_labels}
              </button>
            ) : (
              <span className="text-xs text-muted">{fillWords(b.labelsAtMost, { max: BULK_PRINT_MAX })}</span>
            )}
            {printable ? (
              <>
                <Link href={printHref(slug, [...ticked])} target="_blank" className={secondary}>
                  {b.actions.print_slips}
                </Link>
                <Link href={pickListHref(slug, [...ticked])} target="_blank" className={secondary}>
                  {b.actions.print_pick_list}
                </Link>
              </>
            ) : (
              <span className="text-xs text-muted">
                {allMatching ? b.printOnPage : fillWords(b.printAtMost, { max: BULK_PRINT_MAX })}
              </span>
            )}
          </div>
          {(confirming === "mark_sent" || confirming === "book_labels") && (
            <div role="group" aria-label={confirming === "book_labels" ? b.confirmLabelsLabel : b.confirmLabel} className="flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-sm">
              <p>{countWords(selectedCount, confirming === "book_labels" ? b.confirmLabels : b.confirm, { n: num(selectedCount) })}</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} className="size-4" />
                {b.tell}
              </label>
              <p className={hint} aria-live="polite">
                {notify ? (allMatching ? b.eachEmailed : countWords(emails, b.willEmail)) : b.noEmails}
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={working} onClick={() => run(confirming)} className={primary}>
                  {working ? b.working : b.actions[confirming]}
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={secondary}>
                  {b.cancel}
                </button>
              </div>
            </div>
          )}
          <p className={hint}>
            {fillWords(b.atMost, { max: BULK_MAX })}
          </p>
        </section>
      )}

      {canWrite && banner.kind === "offer" && (
        <p className="rounded-panel bg-sunken p-3 text-sm" role="status">
          {fillWords(b.pageSelected, { n: rows.length })}{" "}
          <button type="button" onClick={() => setAllMatching(true)} className="underline underline-offset-2">
            {fillWords(b.selectMatching, { n: num(banner.matching) })}
          </button>
        </p>
      )}
      {canWrite && banner.kind === "too_many" && (
        <p className="rounded-panel bg-sunken p-3 text-sm" role="status">
          {fillWords(b.pageSelected, { n: rows.length })} {fillWords(b.tooMany, { max: BULK_MAX })}
        </p>
      )}
      {canWrite && banner.kind === "all_matching" && (
        <p className="rounded-panel bg-sunken p-3 text-sm" role="status">
          {fillWords(b.allMatching, { n: num(banner.matching) })}{" "}
          <button type="button" onClick={clear} className="underline underline-offset-2">
            {b.clear}
          </button>
        </p>
      )}

      <div className={tableShell}>
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {canWrite && (
                <th scope="col" className={`${th} w-10`}>
                  <input id={headerId} type="checkbox" checked={allTicked} onChange={toggleAll} aria-label={t.selectAllOnPage} className="size-4" />
                </th>
              )}
              <th scope="col" className={th}>
                {t.order}
              </th>
              {col("placed") && (
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  {t.columns.placed}
                </th>
              )}
              {col("customer") && (
                <th scope="col" className={th}>
                  {t.columns.customer}
                </th>
              )}
              {col("market") && (
                <th scope="col" className={th}>
                  {t.columns.market}
                </th>
              )}
              {col("payment") && (
                <th scope="col" className={th}>
                  {t.columns.payment}
                </th>
              )}
              {col("fulfilment") && (
                <th scope="col" className={th}>
                  {t.columns.fulfilment}
                </th>
              )}
              {col("delivery") && (
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  {t.columns.delivery}
                </th>
              )}
              {col("items") && (
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  {t.columns.items}
                </th>
              )}
              {col("tags") && (
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  {t.columns.tags}
                </th>
              )}
              {col("source") && (
                <th scope="col" className={th}>
                  {t.columns.source}
                </th>
              )}
              {col("total") && (
                <th scope="col" className={`${th} text-right`}>
                  {t.columns.total}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <OrderRow key={row.id} row={row} slug={slug} columns={columns} canWrite={canWrite} ticked={ticked.has(row.id) || allMatching} onToggle={() => toggle(row.id)} words={t} statusWords={statusWords} locale={locale} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderRow({
  row,
  slug,
  columns,
  canWrite,
  ticked,
  onToggle,
  words: t,
  statusWords,
  locale,
}: {
  row: OrderTableRow;
  slug: string;
  columns: readonly OrderColumn[];
  canWrite: boolean;
  ticked: boolean;
  onToggle: () => void;
  words: OrdersMessages["table"];
  statusWords: Record<keyof typeof ORDER_STATUS_LABELS, string>;
  locale: string;
}) {
  const g = t.badges;
  const sources = t.sources;
  const col = (c: OrderColumn) => columns.includes(c);
  const base = `/admin/${slug}`;
  return (
    <tr className="border-b border-line last:border-0">
      {canWrite && (
        <td className={td}>
          <input type="checkbox" checked={ticked} onChange={onToggle} aria-label={fillWords(t.selectOrder, { number: row.number })} className="size-4" />
        </td>
      )}
      <td className={td}>
        <Link href={`${base}/orders/${row.id}`} className="font-medium underline-offset-2 hover:underline">
          #{row.number}
        </Link>
        {row.archived && <span className={badge}>{g.archived}</span>}
        {row.held && <span className={badge}>{g.held}</span>}
        {row.disputed && <span className={badge}>{g.disputed}</span>}
        {row.risk && <span className={badge}>{row.risk === "highest" ? g.highestRisk : g.elevatedRisk}</span>}
        {row.gift && <span className={badge}>{g.gift}</span>}
        {row.source === "draft" && <span className={badge}>{row.draftNumber ? fillWords(g.staffMadeNumber, { number: row.draftNumber }) : g.staffMade}</span>}
        {row.source === "exchange" && <span className={badge}>{g.exchange}</span>}
        {row.preorderFrom ? (
          <span className={badge}>{fillWords(g.preorderFrom, { date: releaseDate(row.preorderFrom, locale) })}</span>
        ) : (
          row.owed > 0 && <span className={badge}>{g.waiting}</span>
        )}
        {row.editPending && <span className={badge}>{g.editPending}</span>}
        {row.edited && <span className={badge}>{g.edited}</span>}
        {row.copied && <span className={badge}>{g.copied}</span>}
        {row.erased && <span className={badge}>{g.erased}</span>}
      </td>
      {col("placed") && (
        <td className={`${td} hidden sm:table-cell`}>
          <time dateTime={row.placedAt}>{row.placedText}</time>
        </td>
      )}
      {col("customer") && (
        <td className={td}>
          {row.erased ? (
            <span className="text-muted">{t.erased}</span>
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
      {col("payment") && <td className={td}>{t.pay[row.pay]}</td>}
      {col("fulfilment") && (
        <td className={td}>
          {row.ship === "none" ? (row.status === "pending_payment" ? "–" : statusWords[row.status]) : shipCellWords(row, t)}
          {row.owed > 0 && (
            <span className="block text-xs">
              {countWords(row.owed, t.owed)}
            </span>
          )}
        </td>
      )}
      {col("delivery") && (
        <td className={`${td} hidden md:table-cell`}>
          <DeliveryText cell={row.delivery} words={t} />
        </td>
      )}
      {col("items") && (
        <td className={`${td} hidden md:table-cell`}>
          {countWords(row.items, t.items)}
        </td>
      )}
      {col("tags") && (
        <td className={`${td} hidden md:table-cell`}>
          {row.tags.length === 0 ? (
            <span className="text-muted">–</span>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {row.tags.map((tag) => (
                <li key={tag.key} className="rounded-full border border-line px-2 py-0.5 text-xs">
                  {tag.label}
                </li>
              ))}
            </ul>
          )}
        </td>
      )}
      {col("source") && <td className={td}>{row.copied ? sources.copied : row.source === "draft" ? sources.draft : row.source === "exchange" ? sources.exchange : sources.checkout}</td>}
      {col("total") && <td className={`${td} text-right tabular-nums`}>{row.totalText}</td>}
    </tr>
  );
}

/** What a bulk action did: "Applied to 41 of 43 orders", the emails sent, and each refusal grouped by its reason with the orders it was for. */
export function ResultPanel({
  result,
  onClose,
  words: b = ordersEn.bulk,
  labelsHref = null,
}: {
  result: BulkResult;
  onClose?: () => void;
  words?: OrdersMessages["bulk"];
  /** Book labels (D374): the page that shows the labels booked, one after another, to print. */
  labelsHref?: string | null;
}) {
  const groups = refusalGroups(result.refused, b);
  // A carrier's own sentence (D374) goes with the order it was said of.
  const refusedName = (r: { number: string | null; detail?: string }) => `${r.number ? `#${r.number}` : b.notFound}${r.detail ? ` (${r.detail})` : ""}`;
  const labelCount = result.labels?.length ?? 0;
  return (
    <section aria-label={b.resultLabel} role="status" className="flex flex-col gap-2 rounded-panel bg-sunken p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{appliedWords(result, b)}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs underline underline-offset-2">
            {b.close}
          </button>
        )}
      </div>
      {result.emailed !== undefined && (
        <p>{countWords(result.emailed, b.emailed)}</p>
      )}
      {labelsHref && labelCount > 0 && (
        <p>
          <Link href={labelsHref} target="_blank" className={primary}>
            {countWords(labelCount, b.printLabels)}
          </Link>
        </p>
      )}
      {groups.length > 0 && (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <li key={group.reason}>
              <span className="font-medium">
                {countWords(group.orders.length, b.notChanged)}
              </span>{" "}
              {group.text}{" "}
              <span className="text-muted">
                {group.orders.length > 12
                  ? fillWords(b.andMore, { list: group.orders.slice(0, 12).map(refusedName).join(", "), n: group.orders.length - 12 })
                  : group.orders.map(refusedName).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


/** The *Delivery* cell (D237): the label kept on the order; a pickup place says *Collect at*, a local delivery where it goes and the start of the note. */
export function DeliveryText({ cell, words: t = ordersEn.table }: { cell: DeliveryCell | undefined; words?: OrdersMessages["table"] }) {
  if (!cell || (!cell.label && cell.method === "ship")) return <span className="text-muted">–</span>;
  if (cell.method === "pickup") return <>{fillWords(t.collectAt, { place: cell.label ?? t.yourPlace })}</>;
  if (cell.method === "local") {
    return (
      <>
        {cell.label ? fillWords(t.localDeliveryTo, { label: cell.label }) : t.localDelivery}
        {(cell.postalCode || cell.city) && <span className="block text-xs">{[cell.postalCode, cell.city].filter(Boolean).join(" ")}</span>}
        {cell.phone && <span className="block text-xs">{cell.phone}</span>}
        {cell.note && <span className="block text-xs text-muted">“{cell.note}”</span>}
      </>
    );
  }
  return <>{cell.label}</>;
}
