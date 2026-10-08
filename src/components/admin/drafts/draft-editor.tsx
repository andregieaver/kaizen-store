"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { DraftActionResponse, DraftProblemWords, SaveDraftResponse } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import { field, hint, secondary } from "@/components/admin/data/ui";
import { addGoods, addTags, customLine, fingerprint, formFromDraft, goodsLine, inputFromForm, moveLine, shipsGoods, type DraftLike, type EditorAddress, type EditorLine, type EditorState } from "@/lib/draft-editor";
import { draftInput, parsePercentBps, type ManualPaymentMethod } from "@/lib/draft-input";
import { draftMarketChoice, draftMarketSlug, type DraftMarketOptions } from "@/lib/draft-markets";
import {
  DRAFT_DISCOUNT_LABEL_MAX,
  DRAFT_INTERNAL_NOTE_MAX,
  DRAFT_LINES_MAX,
  DRAFT_NOTE_TO_BUYER_MAX,
  DRAFT_QUANTITY_MAX,
  DRAFT_TITLE_MAX,
  TAGS_PER_ORDER,
  TAG_MAX_LENGTH,
} from "@/lib/order-limits";
import { formatPriceInput } from "@/lib/product-input";
import type { DraftCustomerChoice, DraftSummary, DraftVariantChoice } from "@/server/draft-orders";

import { DraftSummaryPanel } from "./draft-summary";
import { ActionMessage, PaidOutsideBox, SendBox } from "./draft-send";

export type DraftEditorActions = {
  save: (input: unknown) => Promise<SaveDraftResponse>;
  searchVariants: (marketSlug: string, query: string) => Promise<DraftVariantChoice[]>;
  searchCustomers: (query: string) => Promise<DraftCustomerChoice[]>;
  customerDetails: (customerId: string) => Promise<{ email: string; phone: string | null; shippingAddress: Record<string, string | null>; companyName: string | null; organisationNumber: string | null } | null>;
  send: (request: { version: number; validDays?: number; createLink?: boolean }) => Promise<DraftActionResponse>;
  paidOutside: (input: { version: number; method: ManualPaymentMethod; reference?: string; receivedOn?: string }) => Promise<DraftActionResponse>;
  remove: () => Promise<DraftActionResponse>;
};

export type DraftEditorProps = {
  number: string;
  initial: DraftLike;
  version: number;
  currency: string;
  locale: string;
  initialSummary: DraftSummary | null;
  initialProblems: DraftProblemWords[];
  marketOptions: DraftMarketOptions;
  categories: { code: string; name: string }[];
  defaultDays: number;
  mayRecordOutside: boolean;
  /** The member may read customers (`customers:read`): without it the picker is not drawn, the email is typed. */
  mayFindCustomers: boolean;
  /** Sell to businesses is on (D178): only then are the company's fields offered (a company the draft already has stays on it). */
  companyFields?: boolean;
  actions: DraftEditorActions;
  /** The screen shows a link once; the editor hands it up when a send made one. */
  onResult: (result: DraftActionResponse) => void;
};

type SaveState = "saved" | "dirty" | "saving" | "invalid" | "error" | "conflict";

const addressFields: { key: keyof EditorAddress; label: string; width?: string }[] = [
  { key: "name", label: "Name" },
  { key: "line1", label: "Address" },
  { key: "line2", label: "Address, second line" },
  { key: "postalCode", label: "Postal code", width: "sm:w-32" },
  { key: "city", label: "City" },
  { key: "country", label: "Country code (empty is the market's)", width: "sm:w-40" },
];

function AddressFields({ prefix, value, onChange }: { prefix: string; value: EditorAddress; onChange: (next: EditorAddress) => void }) {
  const id = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {addressFields.map((f) => (
        <label key={f.key} className={`flex flex-col gap-1 text-sm font-medium ${f.width ?? ""}`}>
          {f.label}
          <input
            id={`${id}-${prefix}-${f.key}`}
            value={value[f.key]}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            maxLength={f.key === "country" ? 2 : 120}
            autoComplete="off"
            className={field}
          />
        </label>
      ))}
    </div>
  );
}

const card = "flex flex-col gap-3 rounded-lg border border-border bg-background p-4";

/**
 * The draft order editor (wave 3, D173, `docs/wave-3-orders.md` 2.4): one screen with the market, the customer, the lines (products and custom items, a custom price), the discount the buyer sees, the shipping, the notes and tags,
 * and beside it the summary the SERVER works out from what it saved. The draft saves itself a moment after a change (an open draft holds no stock and takes no number, so saving is harmless) and on *Save draft*; a save carries the
 * version the editor loaded, so a second person's change is refused instead of overwritten. Everything is checked again by the server. Sending and recording a payment outside Kaizen are at the bottom.
 */
export function DraftEditor({ number, initial, version: initialVersion, currency: initialCurrency, locale: initialLocale, initialSummary, initialProblems, marketOptions, categories, defaultDays, mayRecordOutside, mayFindCustomers, companyFields = true, actions, onResult }: DraftEditorProps) {
  const initialForm = useMemo(() => formFromDraft(initial), [initial]);
  const [form, setForm] = useState<EditorState>(initialForm);
  const formRef = useRef(form);
  // The latest state, for a save that runs after the render it was asked in (declared first, so it runs before the effect that asks for the save).
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const versionRef = useRef(initialVersion);
  const savedPrint = useRef(fingerprint(initialForm));
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const conflict = useRef(false);

  const [saveStatus, setStatus] = useState<SaveState>("saved");
  // What was last saved, as the text of its state: whether something is unsaved is read from the difference, never kept as a flag.
  const [savedFp, setSavedFp] = useState(() => fingerprint(initialForm));
  const status: SaveState = saveStatus === "saving" || saveStatus === "conflict" || saveStatus === "invalid" || saveStatus === "error" ? saveStatus : fingerprint(form) !== savedFp ? "dirty" : "saved";
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [summary, setSummary] = useState<DraftSummary | null>(initialSummary);
  const [problems, setProblems] = useState<DraftProblemWords[]>(initialProblems);
  const [money, setMoney] = useState({ currency: initialCurrency, locale: initialLocale });
  const [marketNote, setMarketNote] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [tagText, setTagText] = useState("");
  const [deleteResult, setDeleteResult] = useState<DraftActionResponse | null>(null);

  const patch = useCallback((change: Partial<EditorState>) => setForm((prev) => ({ ...prev, ...change })), []);
  const setLine = (index: number, change: Partial<EditorLine>) => setForm((prev) => ({ ...prev, lines: prev.lines.map((l, i) => (i === index ? { ...l, ...change } : l)) }));

  // ----- Saving ---------------------------------------------------------------------------------------------------
  const doSave = useCallback(async (): Promise<number | null> => {
    if (conflict.current) return null;
    const snapshot = formRef.current;
    const print = fingerprint(snapshot);
    if (print === savedPrint.current) return versionRef.current;
    const input = inputFromForm(snapshot, versionRef.current);
    const checked = draftInput.safeParse(input);
    if (!checked.success) {
      setIssues(checked.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      setStatus("invalid");
      return null;
    }
    // A percent and an amount are read by the server with the draft's currency, so a typed discount is checked there.
    if (snapshot.discount && snapshot.discount.kind === "percent" && snapshot.discount.value.trim() !== "" && parsePercentBps(snapshot.discount.value) === null) {
      setIssues([{ path: "discount", message: "A percent from 0.01 to 100, with at most two decimals." }]);
      setStatus("invalid");
      return null;
    }
    setIssues([]);
    setStatus("saving");
    let answer: SaveDraftResponse;
    try {
      answer = await actions.save(input);
    } catch {
      setStatus("error");
      setMessage("The draft could not be saved. Check your connection and try again.");
      return null;
    }
    if (!answer.ok) {
      if (answer.kind === "conflict") {
        conflict.current = true;
        setStatus("conflict");
      } else {
        setStatus(answer.kind === "invalid" ? "invalid" : "error");
      }
      setMessage(answer.message);
      setIssues((answer.fields ?? []).map((f) => ({ path: f.field, message: f.message })));
      return null;
    }
    versionRef.current = answer.version;
    savedPrint.current = print;
    setMessage(null);
    setSummary(answer.summary);
    setProblems(answer.problems);
    setMarketNote(answer.marketNote);
    if (answer.market) setMoney({ currency: answer.market.currency, locale: answer.market.locale });
    setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    // The server wrote each line's title and SKU and read its list price in the market it was saved in: take them over, line by line, when the lines are still the same.
    setForm((prev) =>
      prev.lines.length === answer.lines.length
        ? { ...prev, lines: prev.lines.map((line, i) => (line.kind === "goods" ? { ...line, title: answer.lines[i].title, sku: answer.lines[i].sku, listPrice: answer.lines[i].listPrice } : line)) }
        : prev,
    );
    setSavedFp(print);
    setStatus("saved");
    return answer.version;
  }, [actions]);

  /** Saves what is on the screen, after any save in flight, and answers the version that is saved (null when it could not be). */
  const saveNow = useCallback((): Promise<number | null> => {
    const next = chain.current.then(doSave, doSave);
    chain.current = next;
    return next;
  }, [doSave]);

  useEffect(() => {
    if (conflict.current) return;
    if (fingerprint(form) === savedPrint.current) return;
    // The save marks the draft "saving" itself; until then the screen reads the difference from the saved state (`dirty` below).
    const timer = setTimeout(() => void saveNow(), 900);
    return () => clearTimeout(timer);
  }, [form, saveNow]);

  // ----- Market ---------------------------------------------------------------------------------------------------
  const choice = draftMarketChoice(marketOptions, form.marketSlug) ?? { country: marketOptions.countries[0]?.code ?? "", lang: "", currency: "" };
  const country = marketOptions.countries.find((c) => c.code === choice.country);
  const setMarket = (next: { country: string; lang: string; currency: string }) => {
    const slug = draftMarketSlug(marketOptions, next);
    if (slug) patch({ marketSlug: slug });
  };

  // ----- Pickers --------------------------------------------------------------------------------------------------
  const [variantQuery, setVariantQuery] = useState("");
  const [variantChoices, setVariantChoices] = useState<DraftVariantChoice[] | null>(null);
  useEffect(() => {
    if (variantQuery.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await actions.searchVariants(form.marketSlug, variantQuery);
      if (live) setVariantChoices(found);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [variantQuery, form.marketSlug, actions]);

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerChoices, setCustomerChoices] = useState<DraftCustomerChoice[] | null>(null);
  useEffect(() => {
    if (customerQuery.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      const found = await actions.searchCustomers(customerQuery);
      if (live) setCustomerChoices(found);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [customerQuery, actions]);

  // A short search shows no list, whatever the last answer was.
  const shownCustomers = customerQuery.trim().length < 2 ? null : customerChoices;
  const shownVariants = variantQuery.trim().length < 2 ? null : variantChoices;

  const chooseCustomer = async (customer: DraftCustomerChoice) => {
    const details = await actions.customerDetails(customer.id);
    setCustomerQuery("");
    setCustomerChoices(null);
    if (!details) return;
    const a = details.shippingAddress;
    patch({
      customerId: customer.id,
      email: details.email,
      phone: details.phone ?? "",
      shippingAddress: { name: a.name ?? "", line1: a.line1 ?? "", line2: a.line2 ?? "", postalCode: a.postalCode ?? "", city: a.city ?? "", country: a.country ?? "" },
      companyName: details.companyName ?? "",
      organisationNumber: details.organisationNumber ?? "",
    });
  };

  // ----- The words under the editor -------------------------------------------------------------------------------
  const ships = shipsGoods(form.lines);
  const blocking = problems.filter((p) => p.blocking);
  const emailMissing = form.email.trim() === "";
  const blockedReason =
    status === "invalid" || issues.length > 0
      ? "Fix what is marked above first."
      : status === "conflict"
        ? "Reload the page: someone else changed this draft."
        : form.lines.length === 0
          ? "Add at least one line."
          : emailMissing
            ? "Add the customer's email address: the pay link goes to it."
            : blocking.length > 0
              ? `Cannot be sent yet: ${blocking[0].text}`
              : null;
  const lineIssue = (index: number) => issues.filter((i) => i.path.startsWith(`lines.${index}.`)).map((i) => i.message);
  const generalIssues = issues.filter((i) => !i.path.startsWith("lines."));
  const dirty = status === "dirty" || status === "saving";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">{number}</span>
          <span className={status === "invalid" || status === "error" || status === "conflict" ? "text-red-700 dark:text-red-400" : "text-muted"}>
            {status === "saving"
              ? "Saving …"
              : status === "dirty"
                ? "Unsaved changes"
                : status === "invalid"
                  ? "Not saved: fix what is marked"
                  : status === "conflict"
                    ? "Not saved: changed by someone else"
                    : status === "error"
                      ? "Not saved"
                      : savedAt
                        ? `Saved at ${savedAt}`
                        : "Saved"}
          </span>
          <button type="button" onClick={() => void saveNow()} disabled={status === "saving" || status === "conflict"} className={secondary}>
            Save draft
          </button>
        </div>
        {message && (
          <p role="alert" className="rounded-lg border border-border bg-surface p-3 text-sm text-red-700 dark:text-red-400">
            {message}
            {status === "conflict" && (
              <>
                {" "}
                <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
                  Reload
                </button>
              </>
            )}
          </p>
        )}
        {generalIssues.length > 0 && (
          <ul role="alert" className="list-disc rounded-lg border border-border bg-surface p-3 pl-8 text-sm text-red-700 dark:text-red-400">
            {generalIssues.map((i, n) => (
              <li key={`${i.path}-${n}`}>{i.message}</li>
            ))}
          </ul>
        )}
        {marketNote && (
          <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">
            The market changed. {marketNote}
          </p>
        )}

        <section aria-labelledby="draft-market" className={card}>
          <h2 id="draft-market" className="font-medium">
            Market
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Country
              <select
                value={choice.country}
                onChange={(e) => {
                  const next = marketOptions.countries.find((c) => c.code === e.target.value)!;
                  setMarket({ country: next.code, lang: next.ownLang, currency: next.ownCurrency });
                }}
                className={field}
              >
                {marketOptions.countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Language
              <select value={choice.lang} onChange={(e) => setMarket({ ...choice, lang: e.target.value })} className={field}>
                {(country?.languages ?? []).map((l) => (
                  <option key={l.lang} value={l.lang}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Currency
              <select value={choice.currency} onChange={(e) => setMarket({ ...choice, currency: e.target.value })} className={field}>
                {(country?.currencies ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={hint}>
            Prices, VAT and the shipping rate follow the market. Changing it takes the new market&apos;s list price on lines that have none of their own; a price you typed stays as typed, now in the new currency, and is marked.
          </p>
        </section>

        <section aria-labelledby="draft-customer" className={card}>
          <h2 id="draft-customer" className="font-medium">
            Customer
          </h2>
          <div className="flex flex-col gap-1">
            {mayFindCustomers && (<>
            <label htmlFor="draft-customer-search" className="text-sm font-medium">
              Find a customer <span className="font-normal text-muted">(name or email)</span>
            </label>
            <input id="draft-customer-search" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} autoComplete="off" className={field} />
            {shownCustomers && (
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface text-sm" aria-label="Customers found">
                {shownCustomers.length === 0 && <li className="p-2 text-muted">No customer found. Type an email below instead.</li>}
                {shownCustomers.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => void chooseCustomer(c)} className="flex w-full flex-col items-start p-2 text-left hover:bg-background">
                      <span>{c.name || c.email}</span>
                      {c.name && <span className="text-xs text-muted">{c.email}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {form.customerId && (
              <p className={hint}>
                Linked to a customer account.{" "}
                <button type="button" onClick={() => patch({ customerId: null })} className="underline underline-offset-2">
                  Unlink
                </button>
              </p>
            )}
            </>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Email <span className="font-normal text-muted">(needed to send)</span>
              <input type="email" value={form.email} onChange={(e) => patch({ email: e.target.value })} maxLength={254} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Phone
              <input value={form.phone} onChange={(e) => patch({ phone: e.target.value })} maxLength={40} autoComplete="off" className={field} />
            </label>
          </div>
          <h3 className="text-sm font-medium">Shipping address {!ships && <span className="font-normal text-muted">(nothing is shipped)</span>}</h3>
          <AddressFields prefix="ship" value={form.shippingAddress} onChange={(next) => patch({ shippingAddress: next })} />
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{companyFields || form.companyName || form.organisationNumber ? "Billing address and company" : "Billing address"}</summary>
            <div className="mt-3 flex flex-col gap-3">
              <AddressFields prefix="bill" value={form.billingAddress} onChange={(next) => patch({ billingAddress: next })} />
              {(companyFields || form.companyName || form.organisationNumber) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 font-medium">
                  Company name
                  <input value={form.companyName} onChange={(e) => patch({ companyName: e.target.value })} maxLength={120} className={field} />
                </label>
                <label className="flex flex-col gap-1 font-medium">
                  Organisation number
                  <input value={form.organisationNumber} onChange={(e) => patch({ organisationNumber: e.target.value })} maxLength={30} className={field} />
                </label>
              </div>
              )}
              {(companyFields || form.companyName || form.organisationNumber) && (
                <p className={hint}>A company needs both. A draft never uses reverse charge: VAT is charged, because a draft has no checked VAT number.</p>
              )}
            </div>
          </details>
        </section>

        <section aria-labelledby="draft-lines" className={card}>
          <h2 id="draft-lines" className="font-medium">
            Lines
          </h2>
          {form.lines.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet. Add a product, or a custom item for something that is not in the catalogue.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {form.lines.map((line, index) => (
                <li key={line.key} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-48 flex-1">
                      {line.kind === "goods" ? (
                        <>
                          <p className="text-sm font-medium break-words">{line.title}</p>
                          <p className="font-mono text-xs text-muted">{line.sku}</p>
                        </>
                      ) : (
                        <label className="flex flex-col gap-1 text-sm font-medium">
                          Custom item <span className="font-normal text-muted">(not in the catalogue, no stock, not shipped)</span>
                          <input value={line.title} onChange={(e) => setLine(index, { title: e.target.value })} maxLength={DRAFT_TITLE_MAX} placeholder="What is it?" className={field} />
                        </label>
                      )}
                    </div>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Quantity
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={DRAFT_QUANTITY_MAX}
                        value={line.quantity}
                        onChange={(e) => setLine(index, { quantity: Math.max(1, Math.min(DRAFT_QUANTITY_MAX, Math.floor(Number(e.target.value) || 1))) })}
                        className={`${field} w-24`}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Price each <span className="font-normal text-muted">(VAT included, {money.currency})</span>
                      <input
                        inputMode="decimal"
                        value={line.price}
                        onChange={(e) => setLine(index, { price: e.target.value })}
                        placeholder={line.listPrice ?? "0,00"}
                        aria-describedby={line.kind === "goods" ? `price-hint-${line.key}` : undefined}
                        className={`${field} w-36`}
                      />
                    </label>
                  </div>
                  {line.kind === "goods" ? (
                    <p id={`price-hint-${line.key}`} className={hint}>
                      {line.price.trim() === "" ? `List price ${line.listPrice ?? ""} in this market.` : `A custom price: it replaces the list price ${line.listPrice ?? ""} and shows the customer no reduction.`}
                    </p>
                  ) : (
                    <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
                      VAT category
                      <select value={line.vatCategory} onChange={(e) => setLine(index, { vatCategory: e.target.value })} className={field}>
                        <option value="">Choose …</option>
                        {categories.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {lineIssue(index).map((text) => (
                    <p key={text} role="alert" className="text-sm text-red-700 dark:text-red-400">
                      {text}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button type="button" disabled={index === 0} onClick={() => patch({ lines: moveLine(form.lines, index, -1) })} className={secondary} aria-label={`Move line ${index + 1} up`}>
                      Up
                    </button>
                    <button type="button" disabled={index === form.lines.length - 1} onClick={() => patch({ lines: moveLine(form.lines, index, 1) })} className={secondary} aria-label={`Move line ${index + 1} down`}>
                      Down
                    </button>
                    <button type="button" onClick={() => patch({ lines: form.lines.filter((_, i) => i !== index) })} className={secondary} aria-label={`Remove line ${index + 1}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {form.lines.length < DRAFT_LINES_MAX ? (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="draft-variant-search" className="text-sm font-medium">
                  Add a product <span className="font-normal text-muted">(title or SKU)</span>
                </label>
                <input id="draft-variant-search" value={variantQuery} onChange={(e) => setVariantQuery(e.target.value)} autoComplete="off" className={field} />
                {shownVariants && (
                  <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface text-sm" aria-label="Products found">
                    {shownVariants.length === 0 && <li className="p-2 text-muted">No product for sale in this market matches. Downloads, subscriptions, bookings and hosts&apos; listings cannot be on a draft.</li>}
                    {shownVariants.map((c) => (
                      <li key={c.variantId}>
                        <button
                          type="button"
                          onClick={() => {
                            patch({ lines: addGoods(form.lines, goodsLine({ variantId: c.variantId, productTitle: c.productTitle, options: c.options, sku: c.sku, listPriceText: formatPriceInput(c.listPriceMinor, money.currency) }), DRAFT_QUANTITY_MAX) });
                            setVariantQuery("");
                            setVariantChoices(null);
                          }}
                          className="flex w-full items-start justify-between gap-3 p-2 text-left hover:bg-background"
                        >
                          <span>
                            {c.productTitle}
                            {c.options !== "Default" && <span className="text-muted"> ({c.options})</span>}
                            <span className="block font-mono text-xs text-muted">{c.sku}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted">
                            {formatPriceInput(c.listPriceMinor, money.currency)} {money.currency} · {c.inStock} in stock
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <button type="button" onClick={() => patch({ lines: [...form.lines, customLine("")] })} className={secondary}>
                  Add a custom item
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">A draft holds at most {DRAFT_LINES_MAX} lines.</p>
          )}
        </section>

        <section aria-labelledby="draft-discount" className={card}>
          <h2 id="draft-discount" className="font-medium">
            Discount
          </h2>
          <div className="grid gap-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Kind
              <select
                value={form.discount?.kind ?? "none"}
                onChange={(e) => {
                  const kind = e.target.value;
                  patch({ discount: kind === "none" ? null : { kind: kind as "percent" | "amount", value: form.discount?.value ?? "", label: form.discount?.label ?? "Discount" } });
                }}
                className={field}
              >
                <option value="none">No discount</option>
                <option value="percent">A percent</option>
                <option value="amount">An amount</option>
              </select>
            </label>
            {form.discount && (
              <>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {form.discount.kind === "percent" ? "Percent" : `Amount (${money.currency})`}
                  <input value={form.discount.value} onChange={(e) => patch({ discount: { ...form.discount!, value: e.target.value } })} inputMode="decimal" placeholder={form.discount.kind === "percent" ? "10" : "0,00"} className={field} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Name <span className="font-normal text-muted">(the buyer sees this on the pay page, the order and the invoice)</span>
                  <input value={form.discount.label} onChange={(e) => patch({ discount: { ...form.discount!, label: e.target.value } })} maxLength={DRAFT_DISCOUNT_LABEL_MAX} className={field} />
                </label>
              </>
            )}
          </div>
          <p className={hint}>The discount takes the goods down, never shipping. VAT is worked out on what is left to pay.</p>
        </section>

        {ships && (
          <section aria-labelledby="draft-shipping" className={card}>
            <h2 id="draft-shipping" className="font-medium">
              Shipping
            </h2>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="sr-only">Shipping</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="shipping" checked={form.shipping.kind === "rate"} onChange={() => patch({ shipping: { ...form.shipping, kind: "rate" } })} className="size-4" />
                The market&apos;s rate (and its free-over limit, as the checkout works it out)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="shipping" checked={form.shipping.kind === "free"} onChange={() => patch({ shipping: { ...form.shipping, kind: "free" } })} className="size-4" />
                Free shipping
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="shipping" checked={form.shipping.kind === "custom"} onChange={() => patch({ shipping: { ...form.shipping, kind: "custom" } })} className="size-4" />
                A price I set
              </label>
              {form.shipping.kind === "custom" && (
                <label className="flex flex-col gap-1 pl-6 font-medium">
                  Shipping price <span className="font-normal text-muted">(VAT included, {money.currency})</span>
                  <input value={form.shipping.price} onChange={(e) => patch({ shipping: { ...form.shipping, price: e.target.value } })} inputMode="decimal" className={`${field} w-36`} />
                </label>
              )}
            </fieldset>
          </section>
        )}

        <section aria-labelledby="draft-notes" className={card}>
          <h2 id="draft-notes" className="font-medium">
            Notes and tags
          </h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Note to the buyer <span className="font-normal text-muted">(shown on the pay page and in the email; {DRAFT_NOTE_TO_BUYER_MAX - form.noteToBuyer.length} characters left)</span>
            <textarea value={form.noteToBuyer} onChange={(e) => patch({ noteToBuyer: e.target.value })} maxLength={DRAFT_NOTE_TO_BUYER_MAX} rows={3} className={`${field} py-2`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Internal note <span className="font-normal text-muted">(never shown to the buyer; do not write about a person; {DRAFT_INTERNAL_NOTE_MAX - form.internalNote.length} left)</span>
            <textarea value={form.internalNote} onChange={(e) => patch({ internalNote: e.target.value })} maxLength={DRAFT_INTERNAL_NOTE_MAX} rows={3} className={`${field} py-2`} />
          </label>
          <div className="flex flex-col gap-2 text-sm">
            <label htmlFor="draft-tags" className="font-medium">
              Tags <span className="font-normal text-muted">(carried to the order when the draft is sent)</span>
            </label>
            {form.tags.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {form.tags.map((tag) => (
                  <li key={tag} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-3 text-xs">
                    {tag}
                    <button type="button" onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })} aria-label={`Remove the tag ${tag}`} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-background">
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <input
                id="draft-tags"
                value={tagText}
                onChange={(e) => setTagText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (tagText.trim() !== "") {
                      patch({ tags: addTags(form.tags, tagText) });
                      setTagText("");
                    }
                  }
                }}
                maxLength={400}
                autoComplete="off"
                className={`${field} min-w-0 flex-1`}
              />
              <button
                type="button"
                disabled={tagText.trim() === ""}
                onClick={() => {
                  patch({ tags: addTags(form.tags, tagText) });
                  setTagText("");
                }}
                className={secondary}
              >
                Add
              </button>
            </div>
            <p className={hint}>
              Up to {TAG_MAX_LENGTH} characters each, {TAGS_PER_ORDER} in all, separated by commas.
            </p>
          </div>
        </section>

        <SendBox
          defaultDays={defaultDays}
          blockedReason={blockedReason}
          ensureSaved={saveNow}
          send={(request) => actions.send(request)}
          onResult={onResult}
        />
        <PaidOutsideBox
          allowed={mayRecordOutside}
          hasEmail={!emailMissing}
          blockedReason={status === "invalid" ? "Fix what is marked above first." : form.lines.length === 0 ? "Add at least one line." : status === "conflict" ? "Reload the page: someone else changed this draft." : blocking.length > 0 ? `Cannot be turned into an order yet: ${blocking[0].text}` : null}
          ensureSaved={saveNow}
          record={(input) => actions.paidOutside(input)}
          onResult={onResult}
        />

        <section aria-labelledby="draft-delete" className="flex flex-col gap-2 text-sm">
          <h2 id="draft-delete" className="font-medium">
            Delete the draft
          </h2>
          <p className={hint}>Nothing else points at an open draft, so it is deleted for good.</p>
          <div>
            <button
              type="button"
              className={secondary}
              onClick={async () => {
                if (!window.confirm(`Delete draft ${number}? This cannot be undone.`)) return;
                setDeleteResult(await actions.remove());
              }}
            >
              Delete draft
            </button>
          </div>
          <ActionMessage result={deleteResult} />
        </section>
      </div>

      <aside className="lg:sticky lg:top-32 lg:self-start">
        <DraftSummaryPanel summary={summary} problems={problems} currency={money.currency} locale={money.locale} state={status === "saving" ? "working" : dirty ? "stale" : "fresh"} />
      </aside>
    </div>
  );
}

