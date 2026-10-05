"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  CONSENT_KEY,
  NEWSLETTER_KEYS,
  checkMessage,
  checkSignup,
  fieldLabel,
  type FormErrors,
  type FormResponse,
  type PublicForm,
  type PublicNewsletter,
} from "@/lib/forms";
import { t, type Messages } from "@/lib/i18n";
import type { FormField } from "@/lib/page-content";

import { Dropdown } from "./dropdown";
import { Inline } from "./inline-text";
import { buttonLook } from "./page-block";
import { usePageLanguage } from "./page-language";

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3 text-base";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

type Values = Record<string, string | boolean>;

const without = (errors: FormErrors, key: string) => {
  const next = { ...errors };
  delete next[key];
  return next;
};
type State = { kind: "idle" | "sending" } | { kind: "done"; text: string } | { kind: "failed"; text: string };

/**
 * A page's form on the site (D93): an email form or a newsletter sign-up,
 * sent to `/api/forms` with the site's owner and the form's id; where it
 * goes is known only to the server. Checked here first with the server's
 * own checks, so mistakes show at once by their fields. A hidden field
 * and the time taken tell robots apart. In the builder's canvas
 * (`preview`) it only shows.
 */
export function SiteForm({ form, store, lang, preview = false }: { form: PublicForm; store: string | null; lang?: string; preview?: boolean }) {
  const pageLang = usePageLanguage();
  const m = t(lang ?? pageLang);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [notice, setNotice] = useState<string | null>(null);
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
    const checked = form.type === "newsletter" ? checkSignup(form, values, consent, m) : checkMessage(form, values, consent, m, m);
    if (!checked.ok) {
      setErrors(checked.errors);
      const first = Object.keys(checked.errors)[0];
      root.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setState({ kind: "sending" });
    setNotice(null);
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store,
          block: form.id,
          values,
          consent,
          website: website.current?.value ?? "",
          lang: lang ?? pageLang,
          path: `${window.location.pathname}${window.location.search}`.slice(0, 500),
          elapsed: Date.now() - shown.current,
        }),
      });
      const answer = (await response.json().catch(() => ({ ok: false }))) as FormResponse;
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
      <div ref={root}>
        <p ref={done} tabIndex={-1} role="status" className="rounded-md bg-surface p-4 outline-none">
          <Inline text={state.text} />
        </p>
      </div>
    );
  }

  const look = buttonLook(form.button, form.button?.fullWidth);
  const sending = state.kind === "sending";
  const button = (
    <button type="submit" disabled={sending} aria-disabled={preview || undefined} className={`${look.className} disabled:opacity-60`} style={look.style}>
      {sending ? m.form.sending : <Inline text={form.submitLabel || (form.type === "newsletter" ? m.form.subscribe : m.form.send)} />}
    </button>
  );

  return (
    <div ref={root} className="flex flex-col gap-4">
      {notice && (
        <p role="status" className="rounded-md bg-surface p-3 text-sm">
          {notice}
        </p>
      )}
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {/* People never see this field; robots fill it in. */}
        <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input ref={website} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        {form.type === "newsletter" ? (
          <NewsletterFields form={form} m={m} values={values} errors={errors} set={set} button={button} />
        ) : (
          form.fields.map((field) => <Field key={field.id} field={field} m={m} value={values[field.id]} error={errors[field.id]} set={set} />)
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

type FieldProps = { m: Messages; set: (key: string, value: string | boolean) => void };

function NewsletterFields({
  form,
  m,
  values,
  errors,
  set,
  button,
}: FieldProps & { form: PublicNewsletter; values: Values; errors: FormErrors; button: ReactNode }) {
  const email = (
    <Field
      field={{ id: NEWSLETTER_KEYS.email, kind: "email", label: "", required: true, placeholder: form.placeholder || m.form.emailPlaceholder }}
      m={m}
      value={values[NEWSLETTER_KEYS.email]}
      error={errors[NEWSLETTER_KEYS.email]}
      set={set}
      hideLabel={form.layout !== "stacked"}
    />
  );
  return (
    <>
      {form.askName && (
        <Field field={{ id: NEWSLETTER_KEYS.name, kind: "name", label: "" }} m={m} value={values[NEWSLETTER_KEYS.name]} error={errors[NEWSLETTER_KEYS.name]} set={set} />
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
const INPUT_TYPE: Partial<Record<FormField["kind"], string>> = { email: "email", phone: "tel" };

function Field({
  field,
  m,
  value,
  error,
  set,
  hideLabel = false,
}: FieldProps & { field: FormField; value: string | boolean | undefined; error?: string; hideLabel?: boolean }) {
  const id = useId();
  const label = fieldLabel(field, m);
  const text = typeof value === "string" ? value : "";
  const described = error ? `${id}-error` : undefined;
  const errorLine = error && (
    <span id={`${id}-error`} className="text-sm font-normal text-red-700 dark:text-red-400">
      {error}
    </span>
  );
  if (field.kind === "checkbox") {
    return <Tick name={field.id} label={label} checked={value === true} onChange={(ticked) => set(field.id, ticked)} error={error} />;
  }
  if (field.kind === "select") {
    return (
      <div className="flex flex-col gap-1" data-field={field.id} tabIndex={-1}>
        <Dropdown
          label={field.required ? label : `${label} (${m.form.optional})`}
          options={[{ value: "", label: field.placeholder || m.form.choose }, ...(field.options ?? []).map((option, index) => ({ value: String(index), label: option }))]}
          value={text}
          onChange={(next) => set(field.id, next)}
        />
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
      <label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
        {!field.required && <span className="font-normal text-muted"> ({m.form.optional})</span>}
      </label>
      {field.kind === "textarea" ? (
        <textarea {...common} rows={5} maxLength={5000} onChange={(event) => set(field.id, event.target.value)} className={`${input} py-2`} />
      ) : (
        <input
          {...common}
          type={INPUT_TYPE[field.kind] ?? "text"}
          autoComplete={AUTOCOMPLETE[field.kind]}
          maxLength={field.kind === "email" ? 254 : 300}
          onChange={(event) => set(field.id, event.target.value)}
          className={input}
        />
      )}
      {errorLine}
    </div>
  );
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

