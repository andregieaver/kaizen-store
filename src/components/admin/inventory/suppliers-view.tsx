"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, label, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ORDER_LANGUAGES, ORDER_METHODS } from "@/lib/drop-shipping";

/**
 * The Suppliers pages' parts (drop shipping, D540, `docs/drop-shipping.md` 8): the form that adds or edits a supplier that ships for the store, the list
 * of products it sends, and the owner's stop. Homer gives a name, an email and a country and presses Add; the rest has sensible defaults one look away.
 * In the admin's language (`useAdminText("inventory")`); the server's refusals keep the server's words. The server checks every permission again.
 */

export type SupplierFormValues = {
  name: string;
  orderEmail: string;
  shipsFrom: string;
  orderLanguage: string;
  dispatchDays: string;
  orderMethod: string;
  returnAddress: string;
  orderNote: string;
};

const BLANK: SupplierFormValues = { name: "", orderEmail: "", shipsFrom: "", orderLanguage: "en", dispatchDays: "2", orderMethod: "email", returnAddress: "", orderNote: "" };

function Message({ message }: { message: { tone: "ok" | "problem"; text: string } | null }) {
  return (
    <div role="status" aria-live="polite">
      {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
    </div>
  );
}

/** Adds a supplier (no `id`; goes to its page once added) or edits one. */
export function SupplierFormCard({
  id,
  initial,
  countries,
  defaultCountry,
  save,
  supplierBase,
}: {
  id: string | null;
  initial?: SupplierFormValues;
  countries: { code: string; name: string }[];
  defaultCountry: string;
  save: (form: SupplierFormValues, id: string | null) => Promise<{ ok: true; id: string } | { ok: false; problem: string }>;
  /** The address of a supplier's page without its id, to open a new one. */
  supplierBase: string;
}) {
  const w = useAdminText("inventory").suppliers;
  const router = useRouter();
  const [values, setValues] = useState<SupplierFormValues>(initial ?? { ...BLANK, shipsFrom: defaultCountry });
  const [more, setMore] = useState(id !== null);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof SupplierFormValues) => (e: { target: { value: string } }) => setValues({ ...values, [key]: e.target.value });
  const prefix = id ?? "new";

  const submit = () =>
    start(async () => {
      setMessage(null);
      const result = await save(values, id);
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      if (id === null) {
        router.push(`${supplierBase}/${result.id}?added=1`);
        return;
      }
      setMessage({ tone: "ok", text: w.saved });
      router.refresh();
    });

  return (
    <form
      className={`${card} flex flex-col gap-4`}
      aria-label={id ? w.detailsTitle : w.addTitle}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-title text-ink">{id ? w.detailsTitle : w.addTitle}</h2>
        {!id && <p className={hint}>{w.addIntro}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${prefix}-name`} className={label}>
            {w.name}
          </label>
          <input id={`${prefix}-name`} required maxLength={120} value={values.name} onChange={set("name")} className={field} autoComplete="organization" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${prefix}-email`} className={label}>
            {w.orderEmail}
          </label>
          <input id={`${prefix}-email`} required type="email" maxLength={254} value={values.orderEmail} onChange={set("orderEmail")} className={field} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${prefix}-country`} className={label}>
            {w.shipsFrom}
          </label>
          <select id={`${prefix}-country`} required value={values.shipsFrom} onChange={set("shipsFrom")} className={field}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!more ? (
        <button type="button" onClick={() => setMore(true)} className="self-start text-sm underline underline-offset-2">
          {w.detailsTitle}
        </button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${prefix}-days`} className={label}>
              {w.dispatchDays}
            </label>
            <input id={`${prefix}-days`} type="number" min={1} max={30} step={1} value={values.dispatchDays} onChange={set("dispatchDays")} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${prefix}-language`} className={label}>
              {w.orderLanguage}
            </label>
            <select id={`${prefix}-language`} value={values.orderLanguage} onChange={set("orderLanguage")} className={field}>
              {ORDER_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {w.languages[l]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${prefix}-method`} className={label}>
              {w.orderMethod}
            </label>
            <select id={`${prefix}-method`} value={values.orderMethod} onChange={set("orderMethod")} className={field} aria-describedby={`${prefix}-method-hint`}>
              {ORDER_METHODS.map((m) => (
                <option key={m} value={m}>
                  {w.methods[m]}
                </option>
              ))}
            </select>
            <p id={`${prefix}-method-hint`} className={hint}>
              {w.methodSoon}
            </p>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-3">
            <label htmlFor={`${prefix}-note`} className={label}>
              {w.orderNote}
            </label>
            <input id={`${prefix}-note`} maxLength={500} value={values.orderNote} onChange={set("orderNote")} placeholder={w.notePlaceholder} className={field} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-3">
            <label htmlFor={`${prefix}-return`} className={label}>
              {w.returnAddress}
            </label>
            <textarea id={`${prefix}-return`} rows={3} maxLength={500} value={values.returnAddress} onChange={set("returnAddress")} className={`${field} py-2`} aria-describedby={`${prefix}-return-hint`} />
            <p id={`${prefix}-return-hint`} className={hint}>
              {w.returnHint}
            </p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || values.name.trim() === "" || values.orderEmail.trim() === ""} className={primary}>
          {id ? w.save : w.add}
        </button>
      </div>
      <Message message={message} />
    </form>
  );
}

export type SupplierVariantRow = { id: string; product: string; title: string; sku: string | null; supplierId: string | null; onHand: number };

/** The physical variants, the supplier's own first: tick some and mark them as sent by it, or take its own back. */
export function SupplierProducts({
  supplierId,
  supplierName,
  rows,
  search,
  canWrite,
  mark,
}: {
  supplierId: string;
  supplierName: string;
  rows: SupplierVariantRow[];
  search: string;
  canWrite: boolean;
  mark: (variantIds: string[], on: boolean) => Promise<{ ok: true; changed: number } | { ok: false; problem: string }>;
}) {
  const w = useAdminText("inventory").suppliers;
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const chosenRows = rows.filter((r) => chosen.has(r.id));
  const toMark = chosenRows.filter((r) => r.supplierId !== supplierId).map((r) => r.id);
  const toUnmark = chosenRows.filter((r) => r.supplierId === supplierId).map((r) => r.id);

  const run = (ids: string[], on: boolean) =>
    start(async () => {
      setMessage(null);
      const result = await mark(ids, on);
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      setChosen(new Set());
      setMessage({ tone: "ok", text: countWords(result.changed, on ? w.marked : w.unmarked, { name: supplierName }) });
      router.refresh();
    });

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="supplier-products">
      <div className="flex flex-col gap-1">
        <h2 id="supplier-products" className="text-title text-ink">
          {w.productsTitle}
        </h2>
        <p className="max-w-3xl text-sm text-muted">{fillWords(w.productsIntro, { name: supplierName })}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <div className="flex flex-col gap-1">
          <label htmlFor="supplier-search" className={label}>
            {w.search}
          </label>
          <input id="supplier-search" name="q" defaultValue={search} className={`${field} w-72`} />
        </div>
        <button type="submit" className={secondary}>
          {w.searchButton}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className={hint}>{w.noProducts}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{w.productsTitle}</caption>
            <thead>
              <tr className="border-b border-line">
                {canWrite && (
                  <th scope="col" className={th}>
                    <span className="sr-only">{w.mark}</span>
                  </th>
                )}
                <th scope="col" className={th}>
                  {w.products}
                </th>
                <th scope="col" className={th}>
                  SKU
                </th>
                <th scope="col" className={th}>
                  {w.sentByColumn}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.stock}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row.title ? `${row.product} · ${row.title}` : row.product;
                const mine = row.supplierId === supplierId;
                return (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    {canWrite && (
                      <td className={td}>
                        <input type="checkbox" checked={chosen.has(row.id)} onChange={() => toggle(row.id)} aria-label={name} className="size-5" />
                      </td>
                    )}
                    <td className={`${td} font-medium`}>{name}</td>
                    <td className={`${td} text-muted`}>{row.sku ?? ""}</td>
                    <td className={td}>{mine ? fillWords(w.sentBy, { name: supplierName }) : row.supplierId ? w.sentByOther : w.sentByYou}</td>
                    <td className={`${td} text-right tabular-nums`}>{mine ? row.onHand : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canWrite && rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending || toMark.length === 0} onClick={() => run(toMark, true)} className={primary}>
            {fillWords(w.mark, { name: supplierName })}
          </button>
          <button type="button" disabled={pending || toUnmark.length === 0} onClick={() => run(toUnmark, false)} className={secondary}>
            {w.unmark}
          </button>
        </div>
      )}
      <p className={hint}>{w.stockHint}</p>
      <Message message={message} />
    </section>
  );
}

/** The owner's stop, confirmed in a second step. */
export function StopSupplier({
  supplierName,
  isOwner,
  stop,
  back,
}: {
  supplierName: string;
  isOwner: boolean;
  stop: () => Promise<{ ok: true; variants: number } | { ok: false; problem: string }>;
  back: string;
}) {
  const t = useAdminText("inventory");
  const w = t.suppliers;
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const result = await stop();
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      setMessage({ tone: "ok", text: countWords(result.variants, w.stopped, { name: supplierName }) });
      router.push(back);
    });
  return (
    <section className={`${card} flex flex-col gap-3`} aria-labelledby="stop-supplier">
      <h2 id="stop-supplier" className="text-title text-ink">
        {fillWords(w.stopTitle, { name: supplierName })}
      </h2>
      <p className="text-sm">{w.stopIntro}</p>
      {!isOwner ? (
        <p className={hint}>{w.ownerOnly}</p>
      ) : confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={run} className={primary}>
            {fillWords(w.stopConfirm, { name: supplierName })}
          </button>
          <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={secondary}>
            {t.locations.notNow}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${secondary} self-start`}>
          {w.stop}
        </button>
      )}
      <Message message={message} />
    </section>
  );
}

