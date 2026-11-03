"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { QuotesMessages } from "@/lib/messages/en-quotes";
import { checkQuoteRequest, DEFAULT_QUOTE_FIELDS, type FieldNeed, type QuoteField, type QuoteFields, type QuoteProblems } from "@/lib/quotes";

import { Dropdown } from "./dropdown";
import { onVariantSelected } from "./variant-selected";

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

/** What the request is about: a product's variants (the one chosen on the page followed), or the cart's lines, which the server reads itself. */
export type QuoteSource =
  | { kind: "product"; productId: string; variants: { id: string; label: string }[]; initial: string }
  | { kind: "cart"; lines: { title: string; quantity: number }[] };

type Answer = { ok: true } | { ok: false; problems?: QuoteProblems; error?: "busy" | "failed" | "not_offered" };
type State = { kind: "idle" | "sending" } | { kind: "done" } | { kind: "failed"; text: string };

/**
 * Request a quote (D431): the button that opens the form in a dialog (the buy part, the cart), or the form in place (the product layout's
 * question part set to a quote). It sends to `/api/quotes` what the shopper typed, the variant and quantity for a product (the variant chosen
 * on the page, `onVariantSelected()`), and nothing for the cart, whose lines the server reads from the cart. Checked here with the server's own
 * check first; a hidden field and the time taken tell robots apart. Words come from the server as props (D212).
 */
export function QuoteRequest({
  store,
  market,
  source,
  prefill,
  fields = DEFAULT_QUOTE_FIELDS,
  labels,
  display = "dialog",
  texts = {},
  block = null,
  primary = false,
}: {
  store: string;
  market: string;
  source: QuoteSource;
  /** A signed-in customer's own details (D365). */
  prefill: { name: string; email: string; phone: string; company: string };
  fields?: QuoteFields;
  labels: QuotesMessages;
  display?: "dialog" | "inline";
  /** The part's own words (heading, words over it, button, thank-you); the language's where empty. */
  texts?: { heading?: string | null; intro?: string; button?: string; sent?: string };
  /** The product layout's part that holds the form, so the server asks its fields. */
  block?: string | null;
  /** The buy part's only way to buy (a product priced on request), drawn as its main button. */
  primary?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = texts.heading === undefined ? labels.heading : texts.heading;
  const headingId = useId();
  if (display === "inline") {
    return (
      <section aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : labels.heading} className="flex flex-col gap-3">
        {heading && (
          <h2 id={headingId} className="font-medium">
            {heading}
          </h2>
        )}
        <QuoteForm store={store} market={market} source={source} prefill={prefill} fields={fields} labels={labels} texts={texts} block={block} />
      </section>
    );
  }
  const button = source.kind === "cart" ? labels.requestCart : texts.button || labels.request;
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`min-h-11 w-full rounded-button px-5 font-medium ${primary ? "button-primary" : "border border-border"}`}
      >
        {button}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-lg bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={headingId} className="text-lg font-heading">
            {heading || labels.heading}
          </h2>
          <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 min-w-11 rounded-md text-sm underline">
            {labels.close}
          </button>
        </div>
        <QuoteForm store={store} market={market} source={source} prefill={prefill} fields={fields} labels={labels} texts={texts} block={block} />
      </dialog>
    </>
  );
}

function QuoteForm({
  store,
  market,
  source,
  prefill,
  fields,
  labels,
  texts,
  block,
}: {
  store: string;
  market: string;
  source: QuoteSource;
  prefill: { name: string; email: string; phone: string; company: string };
  fields: QuoteFields;
  labels: QuotesMessages;
  texts: { intro?: string; sent?: string };
  block: string | null;
}) {
  const [values, setValues] = useState({ name: prefill.name, email: prefill.email, phone: prefill.phone, company: prefill.company, note: "" });
  const [variant, setVariant] = useState(source.kind === "product" ? source.initial : "");
  const [quantity, setQuantity] = useState("1");
  const [problems, setProblems] = useState<QuoteProblems>({});
  const [state, setState] = useState<State>({ kind: "idle" });
  const shown = useRef(0);
  const website = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLParagraphElement>(null);
  const productId = source.kind === "product" ? source.productId : null;

  useEffect(() => {
    shown.current = Date.now();
  }, []);
  // The variant chosen on the page is the one asked about, until the shopper chooses another here.
  useEffect(() => (productId ? onVariantSelected(productId, setVariant) : undefined), [productId]);
  useEffect(() => {
    if (state.kind === "done") done.current?.focus();
  }, [state.kind]);

  const set = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setProblems((current) => ({ ...current, [key]: undefined }));
  };
  const body = () => ({
    store,
    market,
    from: source.kind,
    lines: source.kind === "product" ? [{ variantId: variant, quantity: Number(quantity) }] : [],
    ...values,
    website: website.current?.value ?? "",
    elapsed: Date.now() - shown.current,
    block,
    path: `${window.location.pathname}${window.location.search}`.slice(0, 500),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "sending") return;
    const checked = checkQuoteRequest(body(), fields);
    if (checked && !checked.ok) {
      setProblems(checked.problems);
      const first = Object.keys(checked.problems)[0];
      root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setState({ kind: "sending" });
    try {
      const response = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      const answer = (await response.json().catch(() => ({ ok: false }))) as Answer;
      if (answer.ok) {
        setState({ kind: "done" });
        return;
      }
      if (answer.problems) {
        setProblems(answer.problems);
        setState({ kind: "idle" });
        return;
      }
      setState({ kind: "failed", text: answer.error === "busy" ? labels.busy : answer.error === "not_offered" ? labels.notOffered : labels.failed });
    } catch {
      setState({ kind: "failed", text: labels.failed });
    }
  }

  if (state.kind === "done") {
    return (
      <div ref={root}>
        <p ref={done} tabIndex={-1} role="status" className="rounded-md bg-surface p-4 outline-none">
          {texts.sent || labels.sent}
        </p>
      </div>
    );
  }

  const problemText = (field: QuoteField): string | undefined => {
    const problem = problems[field];
    if (!problem) return undefined;
    if (problem === "invalid" && field === "email") return labels.invalidEmail;
    if (problem === "invalid" && field === "phone") return labels.invalidPhone;
    return labels.problems[problem];
  };
  const sending = state.kind === "sending";
  return (
    <div ref={root} className="flex flex-col gap-4">
      <p className="text-sm text-muted">{texts.intro || (source.kind === "cart" ? labels.cartIntro : labels.intro)}</p>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {/* People never see this field; robots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        {source.kind === "product" ? (
          <div className="flex flex-wrap items-end gap-3" data-field="lines" tabIndex={-1}>
            {source.variants.length > 1 && (
              <div className="min-w-48 flex-1">
                <Dropdown label={labels.variant} options={source.variants.map((v) => ({ value: v.id, label: v.label }))} value={variant} onChange={setVariant} />
              </div>
            )}
            <label className={`${labelClass} w-28`}>
              {labels.quantity}
              <input type="number" inputMode="numeric" min={1} max={9999} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={input} />
            </label>
            {problemText("lines") && <span className="w-full text-sm text-red-700 dark:text-red-400">{problemText("lines")}</span>}
          </div>
        ) : (
          <div>
            <p className="text-sm font-medium">{labels.asking}</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {source.lines.map((line, i) => (
                <li key={`${i}-${line.title}`}>
                  {line.quantity} × {line.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Field id="name" need={fields.name} label={labels.name} optional={labels.optional} value={values.name} problem={problemText("name")} onChange={(v) => set("name", v)} autoComplete="name" />
        <Field id="email" need="required" label={labels.email} hint={labels.emailHint} optional={labels.optional} value={values.email} problem={problemText("email")} onChange={(v) => set("email", v)} type="email" autoComplete="email" />
        <Field id="phone" need={fields.phone} label={labels.phone} optional={labels.optional} value={values.phone} problem={problemText("phone")} onChange={(v) => set("phone", v)} type="tel" autoComplete="tel" />
        <Field id="company" need={fields.company} label={labels.company} optional={labels.optional} value={values.company} problem={problemText("company")} onChange={(v) => set("company", v)} autoComplete="organization" />
        <Field id="note" need={fields.note} label={labels.note} optional={labels.optional} value={values.note} problem={problemText("note")} onChange={(v) => set("note", v)} multiline placeholder={labels.notePlaceholder} />
        <p className="text-xs text-muted">{labels.privacy}</p>
        <div>
          <button type="submit" disabled={sending} className="min-h-11 button-primary rounded-button px-5 font-medium disabled:opacity-60">
            {sending ? labels.sending : labels.send}
          </button>
        </div>
        {state.kind === "failed" && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.text}
          </p>
        )}
      </form>
    </div>
  );
}

function Field({
  id,
  need,
  label,
  hint,
  optional,
  value,
  problem,
  onChange,
  type = "text",
  autoComplete,
  multiline = false,
  placeholder,
}: {
  id: QuoteField;
  need: FieldNeed;
  label: string;
  hint?: string;
  optional: string;
  value: string;
  problem?: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const inputId = useId();
  if (need === "hidden") return null;
  const described = [hint ? `${inputId}-hint` : null, problem ? `${inputId}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id: inputId,
    name: id,
    value,
    placeholder,
    "aria-invalid": problem ? true : undefined,
    "aria-describedby": described,
    "aria-required": need === "required" || undefined,
    "data-field": id,
  } as const;
  return (
    <div className={labelClass}>
      <label htmlFor={inputId}>
        {label}
        {need !== "required" && <span className="font-normal text-muted"> ({optional})</span>}
      </label>
      {multiline ? (
        <textarea {...common} rows={4} maxLength={2000} onChange={(e) => onChange(e.target.value)} className={`${input} py-2`} />
      ) : (
        <input {...common} type={type} autoComplete={autoComplete} maxLength={type === "email" ? 254 : 120} onChange={(e) => onChange(e.target.value)} className={input} />
      )}
      {hint && (
        <span id={`${inputId}-hint`} className="text-xs font-normal text-muted">
          {hint}
        </span>
      )}
      {problem && (
        <span id={`${inputId}-error`} className="text-sm font-normal text-red-700 dark:text-red-400">
          {problem}
        </span>
      )}
    </div>
  );
}
