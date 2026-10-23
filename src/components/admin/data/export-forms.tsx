import { DIALECTS, DIALECT_IDS, type DialectId } from "@/lib/csv";
import { ORDER_SELECTION_MAX } from "@/lib/data-limits";
import { adminText, type AdminAreaMessages } from "@/lib/admin-text";

import { OrderNumbersField } from "./order-numbers-field";
import { card, field, hint, label, primary } from "./ui";

/**
 * The forms of the three export pages (D165, `docs/wave-2-data.md` 2.1, 2.3, 2.4). Each is a plain HTML form that POSTs to its page's file route, which
 * answers with the file at once or sends the member back to the page with the job. No script is needed to ask for a file, and the form holds only the
 * choices the route reads (`parse*ExportOptions()`); nothing a person typed is shown back except in a field.
 */

/** The forms' words; a page passes the account's language (D312 A11), English unless given. */
export type ExportWords = AdminAreaMessages["bookings"]["exports"];
const EN: ExportWords = adminText("en", "bookings").exports;

export function DialectField({ defaultValue, id = "dialect", words: w = EN }: { defaultValue: DialectId; id?: string; words?: ExportWords }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {w.format}
      </label>
      <select id={id} name="dialect" defaultValue={defaultValue} className={field}>
        {DIALECT_IDS.map((d) => (
          <option key={d} value={d}>
            {DIALECTS[d].label}
          </option>
        ))}
      </select>
      <p className={hint}>{w.formatHint}</p>
    </div>
  );
}

export type TermOption = { id: string; name: string; kind: "category" | "tag" };

export function ProductExportForm({ slug, terms, words: w = EN }: { slug: string; terms: TermOption[]; words?: ExportWords }) {
  return (
    <form method="post" action={`/admin/${slug}/products/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{w.whichProducts}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="scope" value="all" defaultChecked /> {w.allProducts}
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="status" /> {w.onlyStatus}
          </label>
          <select name="status" aria-label={w.status} defaultValue="active" className={field}>
            <option value="active">{w.published}</option>
            <option value="draft">{w.drafts}</option>
            <option value="archived">{w.archived}</option>
          </select>
        </div>
        {terms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="term" /> {w.onlyIn}
            </label>
            <select name="termId" aria-label={w.term} className={field} defaultValue={terms[0].id}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "category" ? w.category : w.tag}: {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <DialectField defaultValue="standard" words={w} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="pictures" value="true" defaultChecked className="mt-1" />
        <span>
          {w.pictures}
          <span className={`${hint} block`}>{w.picturesHint}</span>
        </span>
      </label>
      <div>
        <button type="submit" className={primary}>
          {w.exportProducts}
        </button>
      </div>
    </form>
  );
}

export function OrderExportForm({ slug, defaultNumbers, today, words: w = EN }: { slug: string; defaultNumbers: string; today: string; words?: ExportWords }) {
  const startWithNumbers = defaultNumbers.trim() !== "";
  const monthAgo = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <form method="post" action={`/admin/${slug}/orders/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-3">
        <legend className={label}>{w.whichOrders}</legend>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="range" defaultChecked={!startWithNumbers} /> {w.period}
          </label>
          <div className="ml-6 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              {w.from}
              <input type="date" name="from" defaultValue={monthAgo} className={field} />
            </label>
            <label className="flex items-center gap-2">
              {w.to}
              <input type="date" name="to" defaultValue={today} className={field} />
            </label>
          </div>
          <p className={`${hint} ml-6`}>{w.periodHint}</p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="numbers" defaultChecked={startWithNumbers} /> {w.byNumbers}
          </label>
          <div className="ml-6">
            <OrderNumbersField slug={slug} defaultValue={defaultNumbers} max={ORDER_SELECTION_MAX} />
          </div>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{w.whichOfThem}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="which" value="paid" defaultChecked /> {w.paid}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="which" value="all" /> {w.all}
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="copied" value="true" className="mt-1" />
          <span>
            {w.copied}
            <span className={`${hint} block`}>{w.copiedHint}</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{w.layout}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="layout" value="lines" defaultChecked /> {w.perLine}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="layout" value="orders" /> {w.perOrder}
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{w.buyer}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="profile" value="accounting" defaultChecked className="mt-1" />
          <span>
            {w.accounting}
            <span className={`${hint} block`}>{w.accountingHint}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="profile" value="full" className="mt-1" />
          <span>
            {w.full}
            <span className={`${hint} block`}>{w.fullHint}</span>
          </span>
        </label>
      </fieldset>
      <DialectField defaultValue="excel_nordic" words={w} />
      <div>
        <button type="submit" className={primary}>
          {w.exportOrders}
        </button>
      </div>
    </form>
  );
}

export function CustomerExportForm({ slug, words: w = EN }: { slug: string; words?: ExportWords }) {
  return (
    <form method="post" action={`/admin/${slug}/customers/export/file`} className={`${card} flex flex-col gap-4`}>
      <p className="text-sm">{w.customers}</p>
      <DialectField defaultValue="excel_nordic" words={w} />
      <div>
        <button type="submit" className={primary}>
          {w.exportCustomers}
        </button>
      </div>
    </form>
  );
}
