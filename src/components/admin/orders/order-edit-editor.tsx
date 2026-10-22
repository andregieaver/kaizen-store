"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import type { EditActionResponse, EditPreviewResponse } from "@/app/admin/(gated)/[store]/orders/[orderId]/edit/actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { LinkNotice } from "@/components/admin/drafts/draft-send";
import { EDIT_ADDED_LINES_MAX, EDIT_NOTE_MAX, EDIT_QUANTITY_MAX } from "@/lib/fulfilment-limits";
import { formatMoney } from "@/lib/money";
import { editInputFromForm, initialEditForm, variantsTakenOff, type EditFormState, type EditorAdded, type EditorOrderLine } from "@/lib/order-edit-form";
import { ORDER_EDIT_REASONS } from "@/lib/order-edit-status";
import type { EditSummaryView } from "@/lib/order-edit-view";
import { formatPriceInput } from "@/lib/product-input";
import type { DraftVariantChoice } from "@/server/draft-orders";

import { EditOutcome, OutsidePaymentForm, type OutsideInput } from "./order-edit-parts";
import { OrderEditSummary } from "./order-edit-summary";
import { CARD_CLASS } from "@/components/admin/ui";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/drafts-words";

export type OrderEditActions = {
  preview: (raw: unknown) => Promise<EditPreviewResponse>;
  apply: (raw: unknown) => Promise<EditActionResponse>;
  send: (raw: unknown, options: { email: boolean }) => Promise<EditActionResponse>;
  paidOutside: (raw: unknown, outside: OutsideInput) => Promise<EditActionResponse>;
  searchVariants: (query: string) => Promise<DraftVariantChoice[]>;
};

/**
 * The order editor (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): one screen with the order's lines as sold (a kept line's quantity can only go down; 0 takes it
 * off), *Add a product* (the draft's picker: goods sellable in the order's market, priced at the list price as shown or a price typed), the shipping (kept, or a new price
 * with VAT), *Put removed items back in stock*, the reason and a note for staff, and *Tell the customer*. Beside it the summary the SERVER works out (`previewOrderEdit()`,
 * asked again a moment after each change): the browser never works a total out. A lower or equal total is saved at once (a lower one refunded); a higher one is sent to the
 * customer as a pay link, made into a link to share, or recorded as paid outside Kaizen. The order as previewed travels with the save, so a change made meanwhile is refused.
 */
export function OrderEditEditor({
  orderHref,
  number,
  currency,
  locale,
  lines,
  shippingMinor,
  initialSummary,
  hasEmail,
  mayRecordOutside,
  actions,
}: {
  orderHref: string;
  number: string;
  currency: string;
  locale: string;
  lines: EditorOrderLine[];
  shippingMinor: number;
  initialSummary: EditSummaryView | null;
  hasEmail: boolean;
  mayRecordOutside: boolean;
  actions: OrderEditActions;
}) {
  const id = useId();
  const router = useRouter();
  const edit = useAdminText("drafts").edit;
  const w = edit.editor;
  const [form, setForm] = useState<EditFormState>(() => initialEditForm(lines));
  const [summary, setSummary] = useState<EditSummaryView | null>(initialSummary);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<EditActionResponse | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [working, start] = useTransition();
  const input = useMemo(() => editInputFromForm(form, lines, currency, edit.form), [form, lines, currency, edit.form]);
  const takenOff = useMemo(() => variantsTakenOff(form, lines), [form, lines]);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const patch = (change: Partial<EditFormState>) => setForm((prev) => ({ ...prev, ...change }));
  const rawKey = JSON.stringify(input.raw);

  // The summary is the server's: asked a moment after each change of what the change is (never of the note alone).
  const asked = useRef(0);
  useEffect(() => {
    if (input.problems.length > 0) return;
    const ticket = ++asked.current;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const answer = await actions.preview(JSON.parse(rawKey));
        if (ticket !== asked.current) return;
        if (answer.ok) {
          setSummary(answer.summary);
          setPreviewError(null);
        } else {
          setPreviewError([answer.message, ...answer.problems.map((p) => p.text)].join(" "));
        }
      } catch {
        if (ticket === asked.current) setPreviewError(w.summaryFailed);
      } finally {
        if (ticket === asked.current) setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [rawKey, input.problems.length, actions, w]);

  // ----- The product picker ---------------------------------------------------------------------------------------
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<DraftVariantChoice[] | null>(null);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await actions.searchVariants(query);
      if (live) setChoices(found);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, actions]);
  const shownChoices = query.trim().length < 2 ? null : choices;
  const addVariant = (choice: DraftVariantChoice) => {
    const added: EditorAdded = { variantId: choice.variantId, title: choice.productTitle, sku: choice.sku, options: choice.options, listPriceMinor: choice.listPriceMinor, quantity: "1", price: "" };
    patch({ added: [...form.added, added].slice(0, EDIT_ADDED_LINES_MAX) });
    setQuery("");
    setChoices(null);
  };

  // ----- What can be done ---------------------------------------------------------------------------------------
  const fresh = !previewing && input.problems.length === 0 && summary !== null && !previewError;
  const ready = fresh && summary?.ok === true && !input.reasonMissing;
  const why = input.reasonMissing ? w.reasonFirst : !fresh ? w.waitSummary : summary?.ok === false
          ? summary.problems.length > 0 && summary.problems.every((p) => p.code === "no_change")
            ? w.changeFirst
            : w.fixFirst
          : null;
  const mustNotify = summary?.mustNotify ?? false;
  const notify = mustNotify || form.notify;
  const body = () => ({ ...input.raw, notify, base: summary?.base });
  const finish = (answer: EditActionResponse, keepOpen = false) => {
    setResult(answer);
    if (answer.ok && answer.link) setLink(answer.link);
    if (answer.ok && !keepOpen && !answer.link) router.push(orderHref);
  };
  const run = (action: () => Promise<EditActionResponse>, keepOpen = false) =>
    start(async () => {
      setResult(null);
      try {
        finish(await action(), keepOpen);
      } catch {
        setResult({ ok: false, message: w.sendFailed });
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby={`${id}-lines`} className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
          <h2 id={`${id}-lines`} className="text-title text-ink">
            {fillWords(w.items, { number })}
          </h2>
          <p className={hint}>{w.itemsHint}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 font-medium">{w.item}</th>
                  <th scope="col" className="py-2 text-right font-medium">{w.sold}</th>
                  <th scope="col" className="py-2 text-right font-medium">{w.lineTotal}</th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">{w.keep}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.lineId} className={`border-b border-line ${line.editable ? "" : "text-muted"}`}>
                    <td className="py-2">
                      {line.title}
                      {line.sku && <span className="block font-mono text-xs text-muted">{line.sku}</span>}
                      {line.gift && <span className="block text-xs text-muted">{w.gift}</span>}
                      {!line.editable && <span className="block text-xs">{w.staysAsItIs}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{line.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{money(line.totalMinor)}</td>
                    <td className="py-2 pl-3 text-right">
                      {line.editable ? (
                        <span className="inline-flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={line.quantity}
                            value={form.quantities[line.lineId] ?? ""}
                            onChange={(e) => patch({ quantities: { ...form.quantities, [line.lineId]: e.target.value } })}
                            aria-label={fillWords(w.keepOf, { title: line.title })}
                            className={`${field} w-20 text-right tabular-nums`}
                          />
                          <button
                            type="button"
                            onClick={() => patch({ quantities: { ...form.quantities, [line.lineId]: "0" } })}
                            disabled={form.quantities[line.lineId] === "0"}
                            className="text-xs underline underline-offset-2 disabled:opacity-40"
                            aria-label={fillWords(w.removeOf, { title: line.title })}
                          >
                            {w.remove}
                          </button>
                        </span>
                      ) : (
                        <span className="tabular-nums">{line.quantity}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby={`${id}-add`} className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
          <h2 id={`${id}-add`} className="text-title text-ink">
            {w.addProduct}
          </h2>
          <label className="flex flex-col gap-1 font-medium" htmlFor={`${id}-search`}>
            {w.search}
          </label>
          <input id={`${id}-search`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" className={field} />
          {shownChoices && (
            <ul className="flex flex-col divide-y divide-line rounded-md border border-line" aria-label={w.productsFound}>
              {shownChoices.length === 0 && <li className="p-2 text-muted">{w.noProduct}</li>}
              {shownChoices.map((c) => (
                <li key={c.variantId}>
                  <button type="button" onClick={() => addVariant(c)} className="flex w-full items-center justify-between gap-3 p-2 text-left hover:bg-sunken">
                    <span>
                      {c.productTitle}
                      {c.options && <span className="text-muted"> ({c.options})</span>}
                      <span className="block font-mono text-xs text-muted">
                        {c.sku} · {fillWords(w.inStock, { n: c.inStock })}
                      </span>
                    </span>
                    <span className="tabular-nums">{money(c.listPriceMinor)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {form.added.length > 0 && (
            <ul className="flex flex-col gap-3" aria-label={w.productsAdded}>
              {form.added.map((a, index) => (
                <li key={`${a.variantId}-${index}`} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <p>
                    {a.title}
                    {a.options && <span className="text-muted"> ({a.options})</span>} <span className="font-mono text-xs text-muted">{a.sku}</span>
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 font-medium">
                      {w.quantity}
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={EDIT_QUANTITY_MAX}
                        value={a.quantity}
                        onChange={(e) => patch({ added: form.added.map((x, i) => (i === index ? { ...x, quantity: e.target.value } : x)) })}
                        className={`${field} w-24 text-right`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      <span>
                        {w.priceEach} <span className="font-normal text-muted">{fillWords(w.priceEachHint, { price: money(a.listPriceMinor) })}</span>
                      </span>
                      <input
                        inputMode="decimal"
                        value={a.price}
                        placeholder={formatPriceInput(a.listPriceMinor, currency)}
                        onChange={(e) => patch({ added: form.added.map((x, i) => (i === index ? { ...x, price: e.target.value } : x)) })}
                        className={`${field} w-36 text-right`}
                      />
                    </label>
                    <button type="button" onClick={() => patch({ added: form.added.filter((_, i) => i !== index) })} className={secondary}>
                      {w.takeOut}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className={hint}>{fillWords(w.priceHint, { max: EDIT_ADDED_LINES_MAX })}</p>
        </section>

        <section aria-labelledby={`${id}-ship`} className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
          <h2 id={`${id}-ship`} className="text-title text-ink">
            {w.shipping}
          </h2>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{w.shipping}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name={`${id}-shipping`} checked={form.shipping.kind === "keep"} onChange={() => patch({ shipping: { kind: "keep" } })} className="size-4" />
              {fillWords(w.keepShipping, { price: money(shippingMinor) })}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-shipping`}
                checked={form.shipping.kind === "set"}
                onChange={() => patch({ shipping: { kind: "set", amount: formatPriceInput(shippingMinor, currency) } })}
                className="size-4"
              />
              {w.setPrice}
            </label>
            {form.shipping.kind === "set" && (
              <label className="flex flex-col gap-1 font-medium">
                {w.newShipping}
                <input
                  inputMode="decimal"
                  value={form.shipping.amount}
                  onChange={(e) => patch({ shipping: { kind: "set", amount: e.target.value } })}
                  className={`${field} w-36 text-right`}
                />
              </label>
            )}
            <p className={hint}>{w.shippingHint}</p>
          </fieldset>
        </section>

        <section aria-labelledby={`${id}-how`} className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
          <h2 id={`${id}-how`} className="text-title text-ink">
            {w.reasonAndStock}
          </h2>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.restock} onChange={(e) => patch({ restock: e.target.checked })} className="size-4" />
            {w.restock}
          </label>
          {form.restock && takenOff.length > 0 && (
            <fieldset className="flex flex-col gap-1 pl-6">
              <legend className={hint}>{w.untick}</legend>
              {takenOff.map((v) => (
                <label key={v.variantId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!form.noRestock.includes(v.variantId)}
                    onChange={(e) => patch({ noRestock: e.target.checked ? form.noRestock.filter((x) => x !== v.variantId) : [...form.noRestock, v.variantId] })}
                    className="size-4"
                  />
                  {v.title}
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">{w.reason}</legend>
            {ORDER_EDIT_REASONS.map((r) => (
              <label key={r} className="flex items-start gap-2">
                <input type="radio" name={`${id}-reason`} checked={form.reason === r} onChange={() => patch({ reason: r })} className="mt-0.5 size-4" />
                <span>
                  {edit.reasons[r]} <span className="text-muted">{edit.reasonHints[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 font-medium">
            <span>
              {w.note} <span className="font-normal text-muted">{w.noteHint}</span>
            </span>
            <textarea value={form.note} onChange={(e) => patch({ note: e.target.value })} maxLength={EDIT_NOTE_MAX} rows={2} className={`${field} py-2`} />
          </label>
          {hasEmail ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notify} disabled={mustNotify} onChange={(e) => patch({ notify: e.target.checked })} className="size-4" />
              {w.tell}
              {mustNotify && <span className={hint}>{w.tellAlways}</span>}
            </label>
          ) : (
            <p className={hint}>{w.noEmail}</p>
          )}
        </section>
      </div>

      <div className="flex flex-col gap-4">
        <OrderEditSummary summary={summary} currency={currency} locale={locale} state={previewing ? "working" : "fresh"} formProblems={[...input.problems, ...(previewError ? [previewError] : [])]} />
        {link ? (
          <LinkNotice link={link} onClose={() => router.push(orderHref)} />
        ) : (
          <section aria-labelledby={`${id}-save`} className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
            <h2 id={`${id}-save`} className="text-title text-ink">
              {summary?.money === "charge" ? w.askToPay : w.save}
            </h2>
            {summary?.money === "charge" ? (
              <>
                <p className={hint}>{w.chargeHint}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={!ready || working || !hasEmail} onClick={() => run(() => actions.send(body(), { email: true }))} className={primary}>
                    {working ? w.working : w.sendLink}
                  </button>
                  <button type="button" disabled={!ready || working} onClick={() => run(() => actions.send(body(), { email: false }), true)} className={secondary}>
                    {w.share}
                  </button>
                </div>
                <OutsidePaymentForm
                  allowed={mayRecordOutside}
                  disabled={!ready || working}
                  amountText={summary ? money(summary.differenceMinor) : ""}
                  record={(outside) => run(() => actions.paidOutside(body(), outside))}
                />
              </>
            ) : (
              <>
                {summary?.money === "refund" && summary.outside && !mayRecordOutside && (
                  <p className={hint}>{w.outsideRefund}</p>
                )}
                <div>
                  <button
                    type="button"
                    disabled={!ready || working || (summary?.money === "refund" && summary.outside && !mayRecordOutside)}
                    onClick={() => {
                      if (summary?.money === "refund" && !window.confirm(fillWords(w.refundConfirm, { amount: money(Math.abs(summary.differenceMinor)) }))) return;
                      run(() => actions.apply(body()));
                    }}
                    className={primary}
                  >
                    {working ? w.working : summary?.money === "refund" ? w.saveRefund : w.save}
                  </button>
                </div>
              </>
            )}
            {why && <p className="text-muted">{why}</p>}
            <EditOutcome result={result} />
            <Link href={orderHref} className="underline underline-offset-2">
              {w.back}
            </Link>
          </section>
        )}
      </div>
    </div>
  );
}
