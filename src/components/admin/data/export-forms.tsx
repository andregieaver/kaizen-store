import { DIALECTS, DIALECT_IDS, type DialectId } from "@/lib/csv";
import { ORDER_SELECTION_MAX } from "@/lib/data-limits";

import { OrderNumbersField } from "./order-numbers-field";
import { card, field, hint, label, primary } from "./ui";

/**
 * The forms of the three export pages (D165, `docs/wave-2-data.md` 2.1, 2.3, 2.4). Each is a plain HTML form that POSTs to its page's file route, which
 * answers with the file at once or sends the member back to the page with the job. No script is needed to ask for a file, and the form holds only the
 * choices the route reads (`parse*ExportOptions()`); nothing a person typed is shown back except in a field.
 */

export function DialectField({ defaultValue, id = "dialect" }: { defaultValue: DialectId; id?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        File format
      </label>
      <select id={id} name="dialect" defaultValue={defaultValue} className={field}>
        {DIALECT_IDS.map((d) => (
          <option key={d} value={d}>
            {DIALECTS[d].label}
          </option>
        ))}
      </select>
      <p className={hint}>Choose Excel (Nordic) to open the file in Excel in Norwegian, Swedish or Danish: æ, ø and å and the numbers come out right. Choose Standard for other systems.</p>
    </div>
  );
}

export type TermOption = { id: string; name: string; kind: "category" | "tag" };

export function ProductExportForm({ slug, terms }: { slug: string; terms: TermOption[] }) {
  return (
    <form method="post" action={`/admin/${slug}/products/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>Which products</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="scope" value="all" defaultChecked /> All products, including drafts and archived
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="scope" value="status" /> Only products that are
          </label>
          <select name="status" aria-label="Status" defaultValue="active" className={field}>
            <option value="active">published</option>
            <option value="draft">drafts</option>
            <option value="archived">archived</option>
          </select>
        </div>
        {terms.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="term" /> Only products in
            </label>
            <select name="termId" aria-label="Category or tag" className={field} defaultValue={terms[0].id}>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.kind === "category" ? "Category" : "Tag"}: {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>
      <DialectField defaultValue="standard" />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="pictures" value="true" defaultChecked className="mt-1" />
        <span>
          Include the pictures&apos; addresses
          <span className={`${hint} block`}>These are the addresses of the pictures in your media library. Leave them out for a smaller file.</span>
        </span>
      </label>
      <div>
        <button type="submit" className={primary}>
          Export products
        </button>
      </div>
    </form>
  );
}

export function OrderExportForm({ slug, defaultNumbers, today }: { slug: string; defaultNumbers: string; today: string }) {
  const startWithNumbers = defaultNumbers.trim() !== "";
  const monthAgo = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  return (
    <form method="post" action={`/admin/${slug}/orders/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-3">
        <legend className={label}>Which orders</legend>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="range" defaultChecked={!startWithNumbers} /> The orders placed in a period
          </label>
          <div className="ml-6 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2">
              From
              <input type="date" name="from" defaultValue={monthAgo} className={field} />
            </label>
            <label className="flex items-center gap-2">
              to
              <input type="date" name="to" defaultValue={today} className={field} />
            </label>
          </div>
          <p className={`${hint} ml-6`}>Both days count, in the store&apos;s own time zone, by the day the order was placed.</p>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" value="numbers" defaultChecked={startWithNumbers} /> Only some orders, by their numbers
          </label>
          <div className="ml-6">
            <OrderNumbersField slug={slug} defaultValue={defaultNumbers} max={ORDER_SELECTION_MAX} />
          </div>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>Which of them (for a period)</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="which" value="paid" defaultChecked /> Paid orders: those with a captured payment, a cancelled order that was paid included
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="which" value="all" /> All orders, including unfinished checkouts
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="copied" value="true" className="mt-1" />
          <span>
            Include copied history
            <span className={`${hint} block`}>Orders copied from another store are not sales. When included, every row says so and the order number starts with C-.</span>
          </span>
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>Layout</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="layout" value="lines" defaultChecked /> One row per order line
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="layout" value="orders" /> One row per order
        </label>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>What about the buyer</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="profile" value="accounting" defaultChecked className="mt-1" />
          <span>
            Accounting: no contact details
            <span className={`${hint} block`}>The order number, amounts, VAT, delivery country and payment, without the buyer&apos;s email, name or address. The safest file to hand on.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="profile" value="full" className="mt-1" />
          <span>
            Full: with the buyer&apos;s email and the addresses
            <span className={`${hint} block`}>Personal data. An order whose person was erased never carries any, whatever you choose.</span>
          </span>
        </label>
      </fieldset>
      <DialectField defaultValue="excel_nordic" />
      <div>
        <button type="submit" className={primary}>
          Export orders
        </button>
      </div>
    </form>
  );
}

export function CustomerExportForm({ slug }: { slug: string }) {
  return (
    <form method="post" action={`/admin/${slug}/customers/export/file`} className={`${card} flex flex-col gap-4`}>
      <p className="text-sm">One row per customer: everyone with an account and every guest with a paid order, once per email address.</p>
      <DialectField defaultValue="excel_nordic" />
      <div>
        <button type="submit" className={primary}>
          Export customers
        </button>
      </div>
    </form>
  );
}
