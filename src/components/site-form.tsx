"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  CONSENT_KEY,
  NEWSLETTER_KEYS,
  checkMessage,
  checkSignup,
  fieldLabel,
  askedQuestions,
  chosenPlaces,
  type FormErrors,
  type FormResponse,
  type PublicForm,
  type PublicNewsletter,
} from "@/lib/forms";
import { browserText as t } from "@/lib/browser-text";
import type { BrowserMessages as Messages } from "@/lib/browser-text";
import type { FormField } from "@/lib/page-content";
import type { FieldLookAttrs, FieldStyle } from "@/lib/form-field-style";
import { daysAfter, todayInZone } from "@/lib/questions";

import { Dropdown } from "./dropdown";
import { Inline } from "./inline-text";
import { buttonLook } from "./button-look";
import { usePageLanguage } from "./page-language";

/** A field's box: the theme's look, or the owner's field style where the form has one (`kf-ctl`, D878, `form-look-css.ts`). */
const input = "kf-ctl min-h-11 w-full rounded-md border border-border bg-background px-3 text-base";

const labelClass = "flex flex-col gap-1 text-sm font-medium";

type Values = Record<string, string | boolean>;

const without = (errors: FormErrors, key: string) => {
  const next = { ...errors };
  delete next[key];
  return next;
};
/** Milliseconds since a moment (the form shown): robots send at once. */
const msSince = (at: number) => Date.now() - at;
type State = { kind: "idle" | "sending" } | { kind: "done"; text: string } | { kind: "failed"; text: string };

/**
 * A page's form on the site (D93): an email form or a newsletter sign-up,
 * sent to `/api/forms` with the site's owner and the form's id; where it
 * goes is known only to the server. Checked here first with the server's
 * own checks, so mistakes show at once by their fields. A hidden field
 * and the time taken tell robots apart. In the builder's canvas
 * (`preview`) it only shows.
 */
export function SiteForm({
  form,
  store,
  lang,
  preview = false,
  endpoint = "/api/forms",
  extra,
  market,
  payNote,
  look: fieldLook,
}: {
  form: PublicForm;
  store: string | null;
  lang?: string;
  preview?: boolean;
  /** Where it sends: a page's form `/api/forms`; the product question (D431) its own route. */
  endpoint?: string;
  /** More of the request, read when it is sent (the product question's product and chosen variant). */
  extra?: () => Record<string, unknown>;
  /** The page's market: where a form's payment goes in the cart (D738 F6c). */
  market?: string;
  /** What is paid after sending and its price, in the page's language (F6c): shown above the button. */
  payNote?: string;
  /** The form's field style as `fieldStyleAttrs()` made it on the server (D878), so the browser carries no code for it. */
  look?: FieldLookAttrs;
}) {
  const pageLang = usePageLanguage();
  const m = t(lang ?? pageLang);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
  // The files chosen for file questions (D738 F6b), by question: pictures already drawn again as WebP or JPEG.
  const files = useRef<Record<string, File>>({});
  const shown = useRef(0);
  const website = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    shown.current = Date.now();
    if (preview || form.type !== "newsletter") return;
    // Back from the confirmation link: the page's address says how it went.
    const params = new URLSearchParams(window.location.search);
    if (params.get("form") !== form.id) return;
    const result = params.get("newsletter");
    const frame = requestAnimationFrame(() => {
      if (result === "confirmed") setState({ kind: "done", text: form.successMessage || m.form.confirmed });
      else if (result === "expired") setNotice(m.form.expired);
      root.current?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [form.id, form.type, form.successMessage, preview, m.form.confirmed, m.form.expired]);

  useEffect(() => {
    if (state.kind === "done") done.current?.focus();
  }, [state.kind]);

  const set = (key: string, value: string | boolean) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => without(current, key));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview || state.kind === "sending") return;
    const checked = form.type === "newsletter" ? checkSignup(form, values, consent, m) : checkMessage(form, values, consent, m, m, visitorToday(), window.location.search);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = Object.keys(checked.errors)[0];
      root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setState({ kind: "sending" });
    setNotice(null);
    try {
      const payload = JSON.stringify({
        ...extra?.(),
        store,
        block: form.id,
        values,
        consent,
        website: website.current?.value ?? "",
        lang: lang ?? pageLang,
        ...(market ? { market } : {}),
        path: `${window.location.pathname}${window.location.search}`.slice(0, 500),
        elapsed: msSince(shown.current),
      });
      // With files, the request and each file go together as multipart (the browser sets its boundary).
      const asked = form.type === "emailForm" ? askedQuestions(form.fields, values).filter((f) => f.kind === "file" && files.current[f.id]) : [];
      let body: BodyInit = payload;
      if (asked.length > 0) {
        const data = new FormData();
        data.set("request", payload);
        for (const f of asked) data.set(`file:${f.id}`, files.current[f.id]);
        body = data;
      }
      const response = await fetch(endpoint, { method: "POST", ...(asked.length > 0 ? {} : { headers: { "Content-Type": "application/json" } }), body });
      const answer = (await response.json().catch(() => ({ ok: false }))) as FormResponse;
      if (answer.ok && answer.outcome === "pay") {
        // Kept, and on to the store's checkout with the form's product in the cart (F6c).
        window.location.assign(answer.url);
        return;
      }
      if (answer.ok) {
        const text =
          answer.outcome === "confirm"
            ? m.form.checkEmail
            : form.successMessage || (form.type === "newsletter" ? m.form.subscribed : m.form.sent);
        setState({ kind: "done", text });
        return;
      }
      if (answer.errors) setErrors(answer.errors);
      setState(answer.errors ? { kind: "idle" } : { kind: "failed", text: answer.error ?? m.form.failed });
    } catch {
      setState({ kind: "failed", text: m.form.failed });
    }
  }

  if (state.kind === "done") {
    return (
      <div ref={root} data-kz-private="">
        <p ref={done} tabIndex={-1} role="status" className="rounded-md bg-surface p-4 outline-none">
          <Inline text={state.text} />
        </p>
      </div>
    );
  }

  const look = buttonLook(form.button, form.button?.fullWidth);
  // How the labels show (D878); the fields' look is the attributes and custom properties `look` holds.
  const labels = fieldLook?.labels;
  const sending = state.kind === "sending";
  const button = (
    <button type="submit" disabled={sending} aria-disabled={preview || undefined} className={`${look.className} disabled:opacity-60`} style={look.style}>
      {sending ? m.form.sending : <Inline text={form.submitLabel || (form.type === "newsletter" ? m.form.subscribe : m.form.send)} />}
    </button>
  );

  return (
    <div ref={root} data-kz-private="" className="flex flex-col gap-4">
      {notice && (
        <p role="status" className="rounded-md bg-surface p-3 text-sm">
          {notice}
        </p>
      )}
      <form noValidate onSubmit={submit} className="kf-fields flex flex-col gap-4" {...fieldLook?.data} style={fieldLook?.vars}>
        {/* People never see this field; robots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        {form.type === "newsletter" ? (
          <NewsletterFields form={form} m={m} values={values} errors={errors} set={set} button={button} labels={labels} />
        ) : (
          // The questions asked given the answers so far (D705 F3); half-width ones side by side on a wider screen.
          <div className="kf-grid grid gap-4 sm:grid-cols-2">
            {askedQuestions(form.fields, values).map((field) => (
              <div key={field.id} className={field.width === "half" ? "min-w-0" : "min-w-0 sm:col-span-2"}>
                {field.kind === "file" ? (
                  <FileField
                    field={field}
                    m={m}
                    chosen={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
                    error={errors[field.id]}
                    disabled={preview}
                    onFile={(file) => {
                      if (file) files.current[field.id] = file;
                      else delete files.current[field.id];
                      set(field.id, file?.name ?? "");
                    }}
                    onProblem={(problem) => setErrors((current) => ({ ...current, [field.id]: problem }))}
                  />
                ) : (
                  <Field field={field} m={m} value={values[field.id]} error={errors[field.id]} set={set} labels={labels} />
                )}
              </div>
            ))}
          </div>
        )}
        {(form.type === "newsletter" || form.consent) && (
          <Tick
            name={CONSENT_KEY}
            label={form.consent || m.form.newsletterConsent}
            checked={consent}
            onChange={(ticked) => {
              setConsent(ticked);
              setErrors((current) => without(current, CONSENT_KEY));
            }}
            error={errors[CONSENT_KEY]}
          />
        )}
        {payNote && (
          <p className="text-sm" data-form-pay-note>
            {payNote}
          </p>
        )}
        {(form.type === "emailForm" || form.layout === "stacked") && <div>{button}</div>}
        {state.kind === "failed" && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.text}
          </p>
        )}
        {preview && <p className="text-xs text-muted">{m.form.preview}</p>}
      </form>
    </div>
  );
}

type FieldProps = { m: Messages; set: (key: string, value: string | boolean) => void; labels?: FieldStyle["labels"] };

function NewsletterFields({
  form,
  m,
  values,
  errors,
  set,
  button,
  labels,
}: FieldProps & { form: PublicNewsletter; values: Values; errors: FormErrors; button: ReactNode }) {
  const email = (
    <Field
      field={{ id: NEWSLETTER_KEYS.email, kind: "email", label: "", required: true, placeholder: form.placeholder || m.form.emailPlaceholder }}
      m={m}
      value={values[NEWSLETTER_KEYS.email]}
      error={errors[NEWSLETTER_KEYS.email]}
      set={set}
      labels={labels}
      hideLabel={form.layout !== "stacked"}
    />
  );
  return (
    <>
      {form.askName && (
        <Field field={{ id: NEWSLETTER_KEYS.name, kind: "name", label: "" }} m={m} value={values[NEWSLETTER_KEYS.name]} error={errors[NEWSLETTER_KEYS.name]} set={set} labels={labels} />
      )}
      {form.layout === "stacked" ? (
        email
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-48 flex-1">{email}</div>
          {button}
        </div>
      )}
    </>
  );
}

const AUTOCOMPLETE: Partial<Record<FormField["kind"], string>> = { name: "name", email: "email", phone: "tel" };
const INPUT_TYPE: Partial<Record<FormField["kind"], string>> = { email: "email", phone: "tel", number: "number", date: "date" };

/** The visitor's today (`YYYY-MM-DD`): a date question's days count from it in the browser, from the owner's on the server. */
const visitorToday = () => todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

function Field({
  field,
  m,
  value,
  error,
  set,
  labels,
  hideLabel: hiddenByForm = false,
}: FieldProps & { field: FormField; value: string | boolean | undefined; error?: string; hideLabel?: boolean }) {
  const id = useId();
  const label = fieldLabel(field, m);
  const text = typeof value === "string" ? value : "";
  // Hidden where the placeholder names the field (D878), for screen readers still; animated where the field draws it (every kind that
  // reaches the box below has one). The capitals it turns to are a second copy, cross-faded in and read once, as the label.
  const hideLabel = hiddenByForm || (labels === "placeholder" && Boolean(field.placeholder));
  const floats = labels === "animated" && !hideLabel && label !== "";
  const spoken = field.required ? label : `${label} (${m.form.optional})`;
  const words = floats && (
    <>
      <span className="kf-rg">{spoken}</span>
      <span className="kf-up" aria-hidden>
        {spoken}
      </span>
    </>
  );
  const box = floats ? "kf-box" : "contents";
  const moved = text || field.kind === "date" ? "" : undefined;
  const described = error ? `${id}-error` : undefined;
  const errorLine = error && (
    <span id={`${id}-error`} className="text-sm font-normal text-red-700 dark:text-red-400">
      {error}
    </span>
  );
  const helpLine = field.help && <span className="text-sm font-normal text-muted">{field.help}</span>;
  if (field.kind === "checkbox") {
    return (
      <div className="flex flex-col gap-1">
        <Tick name={field.id} label={label} checked={value === true} onChange={(ticked) => set(field.id, ticked)} error={error} />
        {helpLine}
      </div>
    );
  }
  if (field.kind === "radio" || field.kind === "checklist") {
    // The choices' places are sent, as a dropdown's are; a tick list's as `0,2`.
    const chosen = chosenPlaces(field, text);
    const many = field.kind === "checklist";
    return (
      <fieldset className="flex flex-col gap-2" data-field={field.id} tabIndex={-1} aria-invalid={error ? true : undefined} aria-describedby={described}>
        <legend className="kf-label text-sm font-medium">
          {label}
          {!field.required && <span className="font-normal text-muted"> ({m.form.optional})</span>}
        </legend>
        {helpLine}
        {(field.options ?? []).map((option, index) => (
          <label key={index} className="flex items-start gap-2 text-sm">
            <input
              type={many ? "checkbox" : "radio"}
              name={field.id}
              value={index}
              checked={chosen.includes(index)}
              onChange={(event) => {
                if (!many) return set(field.id, String(index));
                const next = event.target.checked ? [...chosen, index] : chosen.filter((p) => p !== index);
                set(field.id, [...next].sort((a, b) => a - b).join(","));
              }}
              className="mt-0.5 size-4 shrink-0 accent-accent"
            />
            <span>{option}</span>
          </label>
        ))}
        {errorLine}
      </fieldset>
    );
  }
  if (field.kind === "select") {
    return (
      <div className="flex flex-col gap-1" data-field={field.id} tabIndex={-1}>
        <div className={box} data-moved={moved}>
          {floats && (
            <span aria-hidden className="kf-float">
              {words}
            </span>
          )}
          <Dropdown
            label={spoken}
            hideLabel={hideLabel || floats}
            options={[{ value: "", label: field.placeholder || m.form.choose }, ...(field.options ?? []).map((option, index) => ({ value: String(index), label: option }))]}
            value={text}
            onChange={(next) => set(field.id, next)}
            boxClassName="kf-ctl kf-drop"
          />
        </div>
        {helpLine}
        {errorLine}
      </div>
    );
  }
  const common = {
    id,
    name: field.id,
    value: text,
    placeholder: field.placeholder || undefined,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": described,
    "aria-required": field.required || undefined,
    "data-field": field.id,
  } as const;
  return (
    <div className={labelClass}>
      {!floats && (
        <label htmlFor={id} className={hideLabel ? "sr-only" : "kf-label"}>
          {label}
          {!field.required && <span className="font-normal text-muted"> ({m.form.optional})</span>}
        </label>
      )}
      <div className={box} data-moved={moved}>
        {floats && (
          <label htmlFor={id} className="kf-float">
            {words}
          </label>
        )}
        {field.kind === "textarea" ? (
          <textarea {...common} rows={5} maxLength={5000} onChange={(event) => set(field.id, event.target.value)} className={`${input} py-2`} />
        ) : (
          <input
            {...common}
            type={INPUT_TYPE[field.kind] ?? "text"}
            autoComplete={AUTOCOMPLETE[field.kind]}
            maxLength={field.kind === "number" || field.kind === "date" ? undefined : field.kind === "email" ? 254 : 300}
            {...boundsOfInput(field)}
            onChange={(event) => set(field.id, event.target.value)}
            className={input}
          />
        )}
      </div>
      {helpLine}
      {errorLine}
    </div>
  );
}

/**
 * A file question (D738 F6b): one picture or PDF. A picture is drawn again here as a WebP (a JPEG where the browser cannot write WebP) of
 * at most `FORM_PICTURE_SIZE` pixels a side, so what is sent is only the picture; a PDF is sent as it is, up to its size. The server checks
 * both again from their bytes.
 */
function FileField({
  field,
  m,
  chosen,
  error,
  disabled,
  onFile,
  onProblem,
}: {
  field: FormField;
  m: Messages;
  chosen: string;
  error?: string;
  disabled: boolean;
  onFile: (file: File | null) => void;
  onProblem: (problem: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preparing, setPreparing] = useState(false);
  const label = fieldLabel(field, m);
  const described = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  async function choose(file: File | undefined) {
    if (!file) return;
    setPreparing(true);
    try {
      // Loaded only once a visitor picks a file: most pages with a form never need it (the front page's first scripts, `performance.spec.ts`).
      const { prepareFile } = await import("./form-file-prepare");
      const ready = await prepareFile(file);
      if (typeof ready === "string") {
        onFile(null);
        onProblem(ready === "too_big" ? m.form.fileTooBig : m.form.fileNotAllowed);
      } else onFile(ready);
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div className="flex flex-col gap-1 text-sm font-medium" data-field={field.id} tabIndex={-1}>
      <span id={`${id}-label`} className="kf-label">
        {label}
        {!field.required && <span className="font-normal text-muted"> ({m.form.optional})</span>}
      </span>
      {field.help && <span className="text-sm font-normal text-muted">{field.help}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`kf-file inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-base font-normal ${disabled ? "pointer-events-none opacity-60" : ""}`}>
          {preparing ? m.form.filePreparing : m.form.fileChoose}
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            disabled={disabled || preparing}
            aria-labelledby={`${id}-label`}
            aria-describedby={described}
            aria-invalid={error ? true : undefined}
            aria-required={field.required || undefined}
            onChange={(event) => void choose(event.target.files?.[0])}
            data-file-input={field.id}
          />
        </label>
        {chosen && (
          <span className="flex items-center gap-2 font-normal" data-file-chosen>
            <span className="max-w-60 truncate">{chosen}</span>
            <button type="button" className="text-muted underline" onClick={() => onFile(null)}>
              {m.form.fileRemove}
            </button>
          </span>
        )}
      </div>
      <span id={`${id}-hint`} className="text-sm font-normal text-muted">
        {m.form.fileHint}
      </span>
      {error && (
        <span id={`${id}-error`} className="text-sm font-normal text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

/** A number's or a date's `min` and `max` for its input: a date's days counted from the visitor's today. */
function boundsOfInput(field: FormField): { min?: string | number; max?: string | number; step?: number; inputMode?: "numeric" } {
  if (field.kind === "number") return { step: 1, inputMode: "numeric", ...(field.min !== undefined && { min: field.min }), ...(field.max !== undefined && { max: field.max }) };
  if (field.kind !== "date") return {};
  const today = visitorToday();
  return { ...(field.min !== undefined && { min: daysAfter(today, field.min) }), ...(field.max !== undefined && { max: daysAfter(today, field.max) }) };
}

function Tick({ name, label, checked, onChange, error }: { name: string; label: string; checked: boolean; onChange: (ticked: boolean) => void; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name={name}
          data-field={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>{label}</span>
      </label>
      {error && (
        <span id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}

