"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";

import type { ExchangeActionResponse, ExchangePreviewResponse } from "@/app/admin/(gated)/[store]/returns/[returnId]/exchange-actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { EXCHANGE_LINES_MAX, EXCHANGE_QUANTITY_MAX } from "@/lib/exchange-limits";
import { builderInput, type BuilderAddress, type BuilderForm, type BuilderLine } from "@/lib/exchange-form";
import { formatMoney } from "@/lib/money";
import type { DraftVariantChoice } from "@/server/draft-orders";
import type { ExchangePreview } from "@/server/exchanges";

import { ExchangeLinkPanel, useShowExchangeLink } from "./exchange-link";
import { ExchangeSummary } from "./exchange-summary";

export type ExchangeBuilderActions = {
  preview: (raw: unknown) => Promise<ExchangePreviewResponse>;
  save: (raw: unknown) => Promise<ExchangeActionResponse>;
  propose: (raw: unknown, createLink: boolean) => Promise<ExchangeActionResponse>;
  searchVariants: (query: string) => Promise<DraftVariantChoice[]>;
};

const ADDRESS_FIELDS: { key: keyof BuilderAddress; label: string; max: number }[] = [
  { key: "name", label: "Name", max: 200 },
  { key: "street", label: "Street", max: 200 },
  { key: "postalCode", label: "Postal code", max: 20 },
  { key: "city", label: "City", max: 100 },
  { key: "country", label: "Country (two letters)", max: 2 },
  { key: "phone", label: "Phone (optional)", max: 40 },
];

/**
 * The exchange builder on a return's page (wave 3, D239, `docs/wave-3-exchanges.md` 2.2): *Add a product* (goods for sale in the original order's market, the draft orders'
 * picker), each replacement's quantity and price (lowered only: a product discount), the shipping (free, the market's standard rate, or a price with VAT) and the delivery
 * address (the order's, editable, in its country). Beside it the SERVER's summary (`previewExchange()`, asked again a moment after each change): the credit with its
 * working, the replacements priced, the total, VAT per rate and the outcome. The browser never adds anything up. *Send to the customer* emails the proposal to the order's
 * own address; *Create a link to share* shows a link once; *Save as draft* keeps it without sending.
 */
export function ExchangeBuilder({
  currency,
  locale = "en-GB",
  initial,
  initialPreview,
  hasEmail,
  shareable = true,
  actions,
}: {
  currency: string;
  locale?: string;
  initial: BuilderForm;
  /** The credit and why the return cannot be exchanged, before anything is chosen. */
  initialPreview: ExchangePreview | null;
  hasEmail: boolean;
  /** False for a withdrawal return: its proposal goes only by email to the order's own address, so only the customer can confirm it (review finding). */
  shareable?: boolean;
  actions: ExchangeBuilderActions;
}) {
  const id = useId();
  const [form, setForm] = useState<BuilderForm>(initial);
  const [preview, setPreview] = useState<ExchangePreview | null>(initialPreview);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ExchangeActionResponse | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const showLink = useShowExchangeLink();
  const [working, start] = useTransition();
  const input = useMemo(() => builderInput(form, currency), [form, currency]);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const patch = (change: Partial<BuilderForm>) => setForm((prev) => ({ ...prev, ...change }));
  const setLine = (index: number, change: Partial<BuilderLine>) => patch({ lines: form.lines.map((l, i) => (i === index ? { ...l, ...change } : l)) });
  const rawKey = JSON.stringify(input.raw);

  // The summary is the server's: asked a moment after each change, once what is typed can be sent.
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
          setPreview(answer.preview);
          setPreviewError(null);
        } else setPreviewError([answer.message, ...answer.problems.map((p) => p.text)].join(" "));
      } catch {
        if (ticket === asked.current) setPreviewError("The summary could not be worked out. Check your connection.");
      } finally {
        if (ticket === asked.current) setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [rawKey, input.problems.length, actions]);

  // The product picker.
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
  const add = (c: DraftVariantChoice) => {
    patch({ lines: [...form.lines, { variantId: c.variantId, title: c.productTitle, sku: c.sku, options: c.options, listPriceMinor: c.listPriceMinor, quantity: "1", price: "" }].slice(0, EXCHANGE_LINES_MAX) });
    setQuery("");
    setChoices(null);
  };

  const fresh = !previewing && input.problems.length === 0 && preview !== null && preview.lines.length > 0 && !previewError;
  const ready = fresh && preview?.ok === true;
  const why = input.problems[0] ?? (previewing || (!fresh && !previewError) ? "Wait for the summary." : previewError ? "Fix the problems in the summary first." : preview?.ok === false ? "Fix the problems in the summary first." : null);
  const run = (work: () => Promise<ExchangeActionResponse>) =>
    start(async () => {
      setResult(null);
      try {
        const answer = await work();
        setResult(answer);
        // Handed to the card's holder when there is one: the refresh after a proposal may stop drawing this builder.
        if (answer.ok && answer.link) (showLink ?? setLink)(answer.link);
      } catch {
        setResult({ ok: false, message: "The request could not be sent to the server. Check your connection and try again: nothing was changed." });
      }
    });

  return (
    <div className="flex flex-col gap-5">
      {link && <ExchangeLinkPanel link={link} onDone={() => setLink(null)} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5 text-sm">
          <section aria-labelledby={`${id}-add`} className="flex flex-col gap-2">
            <h3 id={`${id}-add`} className="text-body-strong text-ink">
              Add a product
            </h3>
            <label className="flex flex-col gap-1 font-medium" htmlFor={`${id}-search`}>
              Search by title or SKU <span className={hint}>(goods for sale in this order&apos;s market)</span>
            </label>
            <input id={`${id}-search`} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" className={field} disabled={form.lines.length >= EXCHANGE_LINES_MAX} />
            {shownChoices && (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line" aria-label="Products found">
                {shownChoices.length === 0 && <li className="p-2 text-muted">No product for sale in this order&apos;s market matches.</li>}
                {shownChoices.map((c) => (
                  <li key={c.variantId}>
                    <button type="button" onClick={() => add(c)} className="flex w-full items-center justify-between gap-3 rounded-pill p-2 text-left hover:bg-sunken">
                      <span>
                        {c.productTitle}
                        {c.options && <span className="text-muted"> ({c.options})</span>}
                        <span className="block font-mono text-xs text-muted">
                          {c.sku} · {c.inStock} in stock
                        </span>
                      </span>
                      <span className="tabular-nums">{money(c.listPriceMinor)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {form.lines.length > 0 && (
            <ul className="flex flex-col gap-3" aria-label="Replacements">
              {form.lines.map((line, index) => (
                <li key={`${line.variantId}-${index}`} className="flex flex-col gap-2 rounded-panel border border-line p-3">
                  <p>
                    {line.title}
                    {line.options && <span className="text-muted"> ({line.options})</span>}
                    <span className="block font-mono text-xs text-muted">
                      {line.sku} · {money(line.listPriceMinor)} in the shop
                    </span>
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1 font-medium">
                      Quantity
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={EXCHANGE_QUANTITY_MAX}
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: e.target.value })}
                        className={`${field} w-24 tabular-nums`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 font-medium">
                      Price each <span className={hint}>(empty: the shop&apos;s price; only lower)</span>
                      <input value={line.price} onChange={(e) => setLine(index, { price: e.target.value })} inputMode="decimal" placeholder={money(line.listPriceMinor)} className={`${field} w-36 tabular-nums`} />
                    </label>
                    <button type="button" onClick={() => patch({ lines: form.lines.filter((_, i) => i !== index) })} className={secondary} aria-label={`Remove ${line.title}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">Shipping of the new order</legend>
            {(
              [
                ["free", "Free"],
                ["standard", "The market's standard rate"],
                ["set", "Set a price (VAT included)"],
              ] as const
            ).map(([value, words]) => (
              <label key={value} className="flex items-center gap-2">
                <input type="radio" name={`${id}-shipping`} value={value} checked={form.shipping === value} onChange={() => patch({ shipping: value })} className="size-4" />
                {words}
              </label>
            ))}
            {form.shipping === "set" && (
              <input aria-label="Shipping price, VAT included" value={form.shippingPrice} onChange={(e) => patch({ shippingPrice: e.target.value })} inputMode="decimal" className={`${field} mt-1 w-36`} />
            )}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-1 font-medium">
              Delivery address <span className={hint}>(the order&apos;s, unless you change it; in the order&apos;s country)</span>
            </legend>
            {ADDRESS_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1 font-medium">
                {f.label}
                <input
                  value={form.address[f.key]}
                  maxLength={f.max}
                  autoComplete="off"
                  onChange={(e) => patch({ address: { ...form.address, [f.key]: e.target.value } })}
                  className={`${field} ${f.key === "country" ? "uppercase sm:w-24" : ""}`}
                />
              </label>
            ))}
          </fieldset>
        </div>

        <div className="flex flex-col gap-3">
          {preview && <ExchangeSummary preview={preview} locale={locale} working={previewing} />}
          {previewError && (
            <p role="alert" className="text-sm text-danger-text">
              {previewError}
            </p>
          )}
          {why && <p className="text-sm text-muted">{why}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={working || !ready || !hasEmail} onClick={() => run(() => actions.propose(input.raw, false))}>
              {working ? "Working …" : "Send to the customer"}
            </button>
            {shareable && (
              <button type="button" className={secondary} disabled={working || !ready} onClick={() => run(() => actions.propose(input.raw, true))}>
                Create a link to share
              </button>
            )}
            <button type="button" className={secondary} disabled={working || input.problems.length > 0} onClick={() => run(() => actions.save(input.raw))}>
              Save as draft
            </button>
          </div>
          {!hasEmail && <p className={hint}>{shareable ? "The order has no email address: create a link to share instead." : "The order has no email address, so a withdrawal's exchange cannot be proposed: refund instead."}</p>}
          {!shareable && <p className={hint}>A withdrawal&apos;s exchange is confirmed by the customer only, so it goes by email to the order&apos;s own address.</p>}
          <p className={hint}>Nothing is held or charged now. The customer confirms on their own page; the new order is made when you process the exchange where you would refund the return.</p>
          {result && (
            <div role={result.ok ? "status" : "alert"} aria-live="polite" className={`flex flex-col gap-1 text-sm ${result.ok ? "" : "text-danger-text"}`}>
              <p>{result.message}</p>
              {result.problems && result.problems.length > 0 && (
                <ul className="list-disc pl-5">
                  {result.problems.map((p, i) => (
                    <li key={`${p.code}-${i}`}>{p.text}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
