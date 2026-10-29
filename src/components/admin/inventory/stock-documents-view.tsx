"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { formatMoney } from "@/lib/money";
import { DOCUMENT_LINES_MAX, type DocumentState } from "@/lib/stock-documents";

/**
 * Stock transfers and purchase orders in the admin (wave 11 unit D, D383): the lists, the form that makes a draft from SKUs and units, and a
 * document's page with its one next step (send or mark as ordered, count units in, cancel). `canWrite` only decides what is drawn; the server
 * checks `products:write` again and holds every rule, and its refusals are shown as it words them. In the admin's language
 * (`useAdminText("inventory").documents`, D312).
 */

type Result = { ok: true; id: string } | { ok: false; problems: string[] };
type Kind = "transfer" | "order";
type Place = { id: string; name: string };

const removeButton = "min-h-9 rounded-pill border border-line px-2 text-xs disabled:opacity-40";

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const run = (job: () => Promise<Result & Record<string, unknown>>, done: (result: Result & Record<string, unknown>) => string, after?: (id: string) => void) =>
    start(async () => {
      setMessage(null);
      const result = await job();
      if (result.ok) {
        setMessage({ tone: "ok", text: done(result) });
        if (after) after(result.id);
        else router.refresh();
      } else setMessage({ tone: "problem", text: result.problems.join(" ") });
    });
  return { pending, message, run };
}

function Status({ message }: { message: { tone: "ok" | "problem"; text: string } | null }) {
  return (
    <div role="status" aria-live="polite">
      {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
    </div>
  );
}

type Line = { sku: string; quantity: string; unitCost: string };
const blankLine = (): Line => ({ sku: "", quantity: "1", unitCost: "" });

/** The form that makes a draft: where from and to (a transfer) or the supplier and where it arrives (an order), and its lines. */
export function NewStockDocument({
  kind,
  places,
  currencies = [],
  mainCurrency = "EUR",
  documentBase,
  create,
}: {
  kind: Kind;
  places: Place[];
  currencies?: string[];
  mainCurrency?: string;
  /** Where a saved draft opens: this address and its id (a plain string, as everything a server page hands a client part). */
  documentBase: string;
  create: (raw: unknown) => Promise<Result>;
}) {
  const w = useAdminText("inventory").documents;
  const router = useRouter();
  const { pending, message, run } = useRunner();
  const [origin, setOrigin] = useState(places[0]?.id ?? "");
  const [destination, setDestination] = useState(places[1]?.id ?? places[0]?.id ?? "");
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [currency, setCurrency] = useState(mainCurrency);
  const [expectedOn, setExpectedOn] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const id = (part: string) => `${kind}-${part}`;
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.sku.trim() !== "");

  const submit = () =>
    run(
      () =>
        create(
          kind === "transfer"
            ? { origin, destination, note, lines: filled.map((l) => ({ sku: l.sku, quantity: l.quantity })) }
            : { supplier, reference, currency, location: destination, expectedOn, note, lines: filled.map((l) => ({ sku: l.sku, quantity: l.quantity, unitCost: l.unitCost })) },
        ),
      () => w.created,
      (saved) => router.push(`${documentBase}/${saved}`),
    );

  return (
    <form
      className={`${card} flex flex-col gap-4`}
      aria-label={kind === "transfer" ? w.newTransfer : w.newOrder}
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-title text-ink">{kind === "transfer" ? w.newTransfer : w.newOrder}</h2>
      <div className="flex flex-wrap items-end gap-3">
        {kind === "order" && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("supplier")} className="text-sm font-medium">
                {w.supplier}
              </label>
              <input id={id("supplier")} value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} className={`${field} w-64`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("reference")} className="text-sm font-medium">
                {w.reference}
              </label>
              <input id={id("reference")} value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className={`${field} w-48`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id("currency")} className="text-sm font-medium">
                {w.currency}
              </label>
              <select id={id("currency")} value={currency} onChange={(e) => setCurrency(e.target.value)} className={field}>
                {[...new Set([mainCurrency, ...currencies])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {kind === "transfer" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={id("origin")} className="text-sm font-medium">
              {w.from}
            </label>
            <select id={id("origin")} value={origin} onChange={(e) => setOrigin(e.target.value)} className={field}>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor={id("destination")} className="text-sm font-medium">
            {kind === "transfer" ? w.to : w.arrivesAt}
          </label>
          <select id={id("destination")} value={destination} onChange={(e) => setDestination(e.target.value)} className={field}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {kind === "order" && (
          <div className="flex flex-col gap-1">
            <label htmlFor={id("expected")} className="text-sm font-medium">
              {w.expected}
            </label>
            <input id={id("expected")} type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} className={field} />
          </div>
        )}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{w.lines}</legend>
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={id(`sku-${i}`)} className={hint}>
                {w.sku}
              </label>
              <input id={id(`sku-${i}`)} value={line.sku} maxLength={64} onChange={(e) => setLine(i, { sku: e.target.value })} className={`${field} w-48`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={id(`units-${i}`)} className={hint}>
                {w.units}
              </label>
              <input id={id(`units-${i}`)} type="number" min={1} step={1} value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={`${field} w-24`} />
            </div>
            {kind === "order" && (
              <div className="flex flex-col gap-1">
                <label htmlFor={id(`cost-${i}`)} className={hint}>
                  {w.unitCost} ({currency})
                </label>
                <input id={id(`cost-${i}`)} inputMode="decimal" value={line.unitCost} maxLength={20} onChange={(e) => setLine(i, { unitCost: e.target.value })} className={`${field} w-32`} />
              </div>
            )}
            <button type="button" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label={fillWords(w.removeLine, { n: i + 1 })} className={removeButton}>
              ×
            </button>
          </div>
        ))}
        <div>
          <button type="button" disabled={lines.length >= DOCUMENT_LINES_MAX} onClick={() => setLines([...lines, blankLine()])} className={secondary}>
            {w.addLine}
          </button>
        </div>
      </fieldset>
      {kind === "order" && <p className={hint}>{fillWords(w.costNote, { currency: mainCurrency })}</p>}
      <div className="flex flex-col gap-1">
        <label htmlFor={id("note")} className="text-sm font-medium">
          {w.note}
        </label>
        <textarea id={id("note")} value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} className={`${field} max-w-xl py-2`} />
      </div>
      <div>
        <button type="submit" disabled={pending || filled.length === 0} className={primary}>
          {pending ? w.saving : w.saveDraft}
        </button>
      </div>
      <Status message={message} />
    </form>
  );
}

export type DocumentRow = {
  id: string;
  href: string;
  state: DocumentState;
  /** A transfer's "From → To", an order's supplier. */
  title: string;
  /** An order's place. */
  place?: string;
  lines: number;
  units: number;
  received: number;
  total?: { minor: number; currency: string };
  expectedOn?: string | null;
  createdAt: string;
};

/** The list of a store's transfers or purchase orders, newest first, each opening its own page. */
export function StockDocumentList({ kind, rows }: { kind: Kind; rows: DocumentRow[] }) {
  const w = useAdminText("inventory").documents;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const states = kind === "transfer" ? w.transferStates : w.orderStates;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  if (rows.length === 0) return <p className="max-w-3xl text-sm text-muted">{kind === "transfer" ? w.noTransfers : w.noOrders}</p>;
  return (
    <div className={tableShell}>
      <table className="w-full text-sm">
        <caption className="sr-only">{kind === "transfer" ? w.transfersCaption : w.ordersCaption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>
              {w.made}
            </th>
            <th scope="col" className={th}>
              {kind === "transfer" ? w.route : w.supplier}
            </th>
            {kind === "order" && (
              <th scope="col" className={th}>
                {w.arrivesAt}
              </th>
            )}
            <th scope="col" className={th}>
              {w.state}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {w.unitsCol}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {w.receivedCol}
            </th>
            {kind === "order" && (
              <th scope="col" className={`${th} text-right`}>
                {w.total}
              </th>
            )}
            <th scope="col" className={th}>
              <span className="sr-only">{w.open}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-0">
              <td className={`${td} whitespace-nowrap`}>{date(row.createdAt)}</td>
              <td className={`${td} font-medium`}>{row.title}</td>
              {kind === "order" && <td className={td}>{row.place}</td>}
              <td className={td}>{states[row.state]}</td>
              <td className={`${td} text-right tabular-nums`}>{row.units.toLocaleString(locale)}</td>
              <td className={`${td} text-right tabular-nums`}>{row.received.toLocaleString(locale)}</td>
              {kind === "order" && <td className={`${td} text-right tabular-nums`}>{row.total ? formatMoney(row.total.minor, row.total.currency, locale) : ""}</td>}
              <td className={`${td} text-right`}>
                <Link
                  href={row.href}
                  aria-label={kind === "transfer" ? fillWords(w.openLabel, { date: date(row.createdAt) }) : fillWords(w.openOrderLabel, { name: row.title })}
                  className="inline-flex min-h-9 items-center rounded-pill border border-edge px-3 text-xs"
                >
                  {w.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type DocumentItem = { variantId: string; sku: string; title: string; quantity: number; received: number; unitCostMinor?: number };

export type DocumentTools = {
  /** Sends a transfer or marks an order as ordered. */
  advance: () => Promise<Result>;
  receive: (raw: unknown) => Promise<Result & { received?: number; costsKept?: number }>;
  cancel: () => Promise<Result>;
};

/** A transfer's or an order's own page: its lines, and the next step its state allows. */
export function StockDocumentDetail({
  kind,
  status,
  from,
  to,
  currency,
  mainCurrency,
  items,
  canWrite,
  tools,
}: {
  kind: Kind;
  status: string;
  /** A transfer's origin. */
  from?: string;
  /** A transfer's destination, an order's place. */
  to: string;
  /** An order's currency. */
  currency?: string;
  mainCurrency?: string;
  items: DocumentItem[];
  canWrite: boolean;
  tools: DocumentTools;
}) {
  const w = useAdminText("inventory").documents;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const { pending, message, run } = useRunner();
  const open = status === (kind === "transfer" ? "sent" : "ordered");
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.variantId, String(Math.max(0, i.quantity - i.received))])));

  const receive = () =>
    run(
      () => tools.receive({ lines: items.map((i) => ({ variantId: i.variantId, quantity: Number(counts[i.variantId] || 0) })) }),
      (r) => {
        const n = Number(r.received ?? 0);
        const kept = Number(r.costsKept ?? 0);
        const said = countWords(n, w.receivedUnits, { n: n.toLocaleString(locale) });
        return kept > 0 ? `${said} ${countWords(kept, w.costsKept, { n: kept.toLocaleString(locale), currency: currency ?? "" })}` : said;
      },
    );

  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <div className={tableShell}>
        <table className="w-full text-sm">
          <caption className="sr-only">{w.lines}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className={th}>
                {w.item}
              </th>
              <th scope="col" className={th}>
                {w.sku}
              </th>
              {kind === "order" && (
                <th scope="col" className={`${th} text-right`}>
                  {w.unitCost}
                </th>
              )}
              <th scope="col" className={`${th} text-right`}>
                {w.unitsCol}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {w.receivedCol}
              </th>
              <th scope="col" className={`${th} text-right`}>
                {w.toCome}
              </th>
              {open && canWrite && (
                <th scope="col" className={th}>
                  {w.arrive}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.variantId} className="border-b border-line last:border-0">
                <td className={`${td} font-medium`}>{item.title}</td>
                <td className={td}>{item.sku}</td>
                {kind === "order" && <td className={`${td} text-right tabular-nums`}>{item.unitCostMinor !== undefined && currency ? formatMoney(item.unitCostMinor, currency, locale) : ""}</td>}
                <td className={`${td} text-right tabular-nums`}>{item.quantity.toLocaleString(locale)}</td>
                <td className={`${td} text-right tabular-nums`}>{item.received.toLocaleString(locale)}</td>
                <td className={`${td} text-right tabular-nums`}>{Math.max(0, item.quantity - item.received).toLocaleString(locale)}</td>
                {open && canWrite && (
                  <td className={td}>
                    <input
                      type="number"
                      min={0}
                      max={item.quantity - item.received}
                      step={1}
                      aria-label={`${w.arrive}: ${item.sku}`}
                      value={counts[item.variantId] ?? "0"}
                      disabled={item.received >= item.quantity}
                      onChange={(e) => setCounts({ ...counts, [item.variantId]: e.target.value })}
                      className={`${field} w-24`}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!canWrite && <p className={hint}>{w.readOnly}</p>}

      {canWrite && status === "draft" && (
        <section className={`${card} flex flex-col gap-2`}>
          <p className="text-sm">{kind === "transfer" ? fillWords(w.sendHint, { from: from ?? "", to }) : w.orderHint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => run(tools.advance, () => (kind === "transfer" ? w.sent : w.ordered))} className={primary}>
              {kind === "transfer" ? w.send : w.order}
            </button>
            <button type="button" disabled={pending} onClick={() => run(tools.cancel, () => w.cancelled)} className={secondary}>
              {kind === "transfer" ? w.cancelTransfer : w.cancelOrder}
            </button>
          </div>
        </section>
      )}

      {canWrite && open && (
        <section className={`${card} flex flex-col gap-2`}>
          <h2 className="text-title text-ink">{w.receiveTitle}</h2>
          <p className="text-sm text-muted">{w.receiveHint}</p>
          {kind === "order" && mainCurrency && <p className={hint}>{fillWords(w.costNote, { currency: mainCurrency })}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={receive} className={primary}>
              {w.receive}
            </button>
            <button type="button" disabled={pending} onClick={() => run(tools.cancel, () => w.cancelled)} className={secondary}>
              {kind === "transfer" ? w.cancelTransfer : w.cancelOrder}
            </button>
          </div>
          <p className={hint}>{kind === "transfer" ? fillWords(w.cancelTransferHint, { from: from ?? "" }) : w.cancelOrderHint}</p>
        </section>
      )}

      {status === "received" && <p className="text-sm">{w.allIn}</p>}
      <Status message={message} />
    </div>
  );
}
