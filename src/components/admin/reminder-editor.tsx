"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";

import {
  buildReminderEmail,
  type ReminderLine,
  type ReminderStepInput,
  type ReminderText,
} from "@/lib/cart-reminders";
import { renderEmail } from "@/lib/email-layout";
import { CARD_CLASS } from "@/components/admin/ui";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

type Save = (input: ReminderStepInput) => Promise<{ ok: true; id?: string } | { ok: false; problems: string[] }>;
type SendTest = (locale: string) => Promise<{ ok: boolean; message: string }>;

export type ReminderLanguage = {
  locale: string;
  /** "Norsk (Norge)". */
  label: string;
  currency: string;
  footer: string[];
  sample: ReminderLine[];
};

type Unit = "minutes" | "hours" | "days";
const UNIT_MINUTES: Record<Unit, number> = { minutes: 1, hours: 60, days: 24 * 60 };

function split(minutes: number): { amount: string; unit: Unit } {
  if (minutes % UNIT_MINUTES.days === 0) return { amount: String(minutes / UNIT_MINUTES.days), unit: "days" };
  if (minutes % UNIT_MINUTES.hours === 0) return { amount: String(minutes / UNIT_MINUTES.hours), unit: "hours" };
  return { amount: String(minutes), unit: "minutes" };
}

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/**
 * One cart reminder (D33): when it goes, whether it carries a discount
 * code, and its text in each of the store's languages, beside a preview
 * of the email exactly as shoppers get it.
 */
export function ReminderEditor({
  initial,
  storeName,
  languages,
  discounts,
  save,
  sendTest,
  back,
  purpose = "cart",
}: {
  initial: { id: string | null; delayMinutes: number; active: boolean; discountCodeId: string | null; content: Record<string, ReminderText> };
  storeName: string;
  languages: ReminderLanguage[];
  discounts: { id: string; code: string; gives: string }[];
  save: Save;
  sendTest: SendTest | null;
  back: string;
  /** A store's cart reminders, or Kaizen's plan reminders to owners (D33). */
  purpose?: "cart" | "plan";
}) {
  const router = useRouter();
  const w = useAdminText("platform").reminderEditor;
  const id = useId();
  const start = split(initial.delayMinutes);
  const [amount, setAmount] = useState(start.amount);
  const [unit, setUnit] = useState<Unit>(start.unit);
  const [active, setActive] = useState(initial.active);
  const [discountCodeId, setDiscountCodeId] = useState(initial.discountCodeId ?? "");
  const [content, setContent] = useState(initial.content);
  const [locale, setLocale] = useState(languages[0]?.locale ?? "");
  const [problems, setProblems] = useState<string[]>([]);
  const [testMessage, setTestMessage] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const [testing, startTesting] = useTransition();

  const language = languages.find((l) => l.locale === locale) ?? languages[0];
  const text = useMemo(() => content[locale] ?? { subject: "", heading: "", body: "", button: "" }, [content, locale]);
  const setText = (key: keyof ReminderText, value: string) =>
    setContent((current) => ({ ...current, [locale]: { ...text, [key]: value } }));
  const code = discounts.find((d) => d.id === discountCodeId)?.code ?? null;

  const preview = useMemo(() => {
    if (!language) return null;
    return renderEmail(
      buildReminderEmail({
        text,
        locale: language.locale,
        currency: language.currency,
        storeName,
        footer: language.footer,
        lines: language.sample,
        code,
        restoreUrl: "#",
        unsubscribeUrl: "#",
        purpose,
      }),
    );
  }, [text, language, storeName, code, purpose]);

  const submit = () =>
    startSaving(async () => {
      const result = await save({
        delayMinutes: Math.round(Number(amount) * UNIT_MINUTES[unit]),
        active,
        discountCodeId: discountCodeId || null,
        content,
      });
      if (result.ok) {
        router.push(back);
        router.refresh();
      } else {
        setProblems(result.problems);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-6"
      >
        {problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
            <p className="font-medium">{w.fix}</p>
            <ul className="mt-2 list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby={`${id}-when`} className={card}>
          <h2 id={`${id}-when`} className="text-title text-ink">
            {w.when}
          </h2>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{w.sendAfter}</legend>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                inputMode="numeric"
                aria-label={w.howLong}
                className={`${input} max-w-28`}
              />
              <select value={unit} onChange={(event) => setUnit(event.target.value as Unit)} aria-label={w.unit} className={`${input} max-w-40`}>
                <option value="minutes">{w.minutes}</option>
                <option value="hours">{w.hours}</option>
                <option value="days">{w.days}</option>
              </select>
            </div>
            <p className={hint}>
              {purpose === "plan"
                ? w.planWhen
                : w.cartWhen}
            </p>
          </fieldset>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4" />
            {w.on}
          </label>
        </section>

        <section aria-labelledby={`${id}-code`} className={card}>
          <h2 id={`${id}-code`} className="text-title text-ink">
            {w.code}
          </h2>
          <label className={label}>
            {w.codeIn}
            <select value={discountCodeId} onChange={(event) => setDiscountCodeId(event.target.value)} className={input}>
              <option value="">{w.none}</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} ({d.gives})
                </option>
              ))}
            </select>
          </label>
          <p className={hint}>
            {purpose === "plan"
              ? w.planCode
              : w.cartCode}
          </p>
        </section>

        <section aria-labelledby={`${id}-text`} className={card}>
          <h2 id={`${id}-text`} className="text-title text-ink">
            {w.email}
          </h2>
          {languages.length > 1 && (
            <div role="group" aria-label={w.language} className="flex flex-wrap gap-1 rounded-full bg-sunken p-1">
              {languages.map((l) => (
                <button
                  key={l.locale}
                  type="button"
                  aria-pressed={l.locale === locale}
                  onClick={() => setLocale(l.locale)}
                  className={`min-h-9 rounded-full px-3 text-sm ${l.locale === locale ? "bg-card font-medium shadow-sm" : "text-muted"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
          <label className={label}>
            {w.subject}
            <input value={text.subject} onChange={(event) => setText("subject", event.target.value)} required maxLength={150} className={input} />
          </label>
          <label className={label}>
            {w.heading}
            <input value={text.heading} onChange={(event) => setText("heading", event.target.value)} required maxLength={150} className={input} />
          </label>
          <label className={label}>
            {w.message}
            <textarea
              value={text.body}
              onChange={(event) => setText("body", event.target.value)}
              required
              maxLength={3000}
              rows={6}
              className={`${input} py-2`}
            />
          </label>
          <label className={label}>
            {w.button}
            <input value={text.button} onChange={(event) => setText("button", event.target.value)} required maxLength={60} className={input} />
          </label>
          <p className={hint}>
            {w.placeholders}
            {purpose === "plan" ? w.planAdded : w.cartAdded}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
          >
            {saving ? w.saving : w.save}
          </button>
          <a href={back} className="text-sm underline">
            {w.cancel}
          </a>
        </div>
      </form>

      <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-3 lg:sticky lg:top-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-preview`} className="text-title text-ink">
            {languages.length > 1 && language ? fillWords(w.previewOf, { language: language.label }) : w.preview}
          </h2>
          {sendTest && (
            <button
              type="button"
              disabled={testing}
              onClick={() => startTesting(async () => setTestMessage(await sendTest(locale)))}
              className="min-h-10 rounded-pill border border-edge px-3 text-sm disabled:opacity-50"
            >
              {testing ? w.sending : w.sendTest}
            </button>
          )}
        </div>
        {testMessage && (
          <p role="status" className={`text-sm ${testMessage.ok ? "" : "text-danger-text "}`}>
            {testMessage.message}
          </p>
        )}
        {sendTest && <p className={hint}>{purpose === "plan" ? w.testPlan : w.testCart}</p>}
        {preview && (
          <div className={`overflow-hidden ${CARD_CLASS}`}>
            <p className="border-b border-line px-4 py-2 text-sm">
              <span className="text-muted">{w.subjectLabel}</span> {preview.subject}
            </p>
            <iframe title={w.previewTitle} srcDoc={preview.html} sandbox="" className="h-[36rem] w-full bg-white" />
          </div>
        )}
      </section>
    </div>
  );
}
