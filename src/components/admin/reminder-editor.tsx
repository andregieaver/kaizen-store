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

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

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
  const text = content[locale] ?? { subject: "", heading: "", body: "", button: "" };
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
          <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
            <p className="font-medium">Nothing was saved yet. Please fix:</p>
            <ul className="mt-2 list-disc pl-5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        )}

        <section aria-labelledby={`${id}-when`} className={card}>
          <h2 id={`${id}-when`} className="font-medium">
            When it goes
          </h2>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Send it after</legend>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
                inputMode="numeric"
                aria-label="How long"
                className={`${input} max-w-28`}
              />
              <select value={unit} onChange={(event) => setUnit(event.target.value as Unit)} aria-label="Unit" className={`${input} max-w-40`}>
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
            <p className={hint}>
              {purpose === "plan"
                ? "Counted from when the owner went to pay. At least 30 minutes, at most 30 days. Reminders stop as soon as the store is on a plan."
                : "Counted from when the shopper typed their email at checkout. At least 30 minutes, at most 30 days. Reminders stop as soon as the cart is bought."}
            </p>
          </fieldset>
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4" />
            Switched on
          </label>
        </section>

        <section aria-labelledby={`${id}-code`} className={card}>
          <h2 id={`${id}-code`} className="font-medium">
            Discount code (optional)
          </h2>
          <label className={label}>
            Code in this reminder
            <select value={discountCodeId} onChange={(event) => setDiscountCodeId(event.target.value)} className={input}>
              <option value="">None</option>
              {discounts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} ({d.gives})
                </option>
              ))}
            </select>
          </label>
          <p className={hint}>
            {purpose === "plan"
              ? "Shown in the email and applied to the plan when the owner follows the link. Make codes under Discounts; a code that is switched off is left out."
              : "Shown in the email and added to the cart when the shopper follows the link. Make codes under Coupons; a code that is switched off is left out."}
          </p>
        </section>

        <section aria-labelledby={`${id}-text`} className={card}>
          <h2 id={`${id}-text`} className="font-medium">
            The email
          </h2>
          {languages.length > 1 && (
            <div role="group" aria-label="Language" className="flex flex-wrap gap-1 rounded-full bg-surface p-1">
              {languages.map((l) => (
                <button
                  key={l.locale}
                  type="button"
                  aria-pressed={l.locale === locale}
                  onClick={() => setLocale(l.locale)}
                  className={`min-h-9 rounded-full px-3 text-sm ${l.locale === locale ? "bg-background font-medium shadow-sm" : "text-muted"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
          <label className={label}>
            Subject
            <input value={text.subject} onChange={(event) => setText("subject", event.target.value)} required maxLength={150} className={input} />
          </label>
          <label className={label}>
            Heading
            <input value={text.heading} onChange={(event) => setText("heading", event.target.value)} required maxLength={150} className={input} />
          </label>
          <label className={label}>
            Message
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
            Button
            <input value={text.button} onChange={(event) => setText("button", event.target.value)} required maxLength={60} className={input} />
          </label>
          <p className={hint}>
            {"{store}"} becomes the store&apos;s name and {"{code}"} the discount code. A blank line starts a new paragraph.
            {purpose === "plan"
              ? " The plan, its price and the link to stop reminders are added for you."
              : " The cart, its total and the link to stop reminders are added for you."}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50"
          >
            {saving ? "Saving …" : "Save reminder"}
          </button>
          <a href={back} className="text-sm underline">
            Cancel
          </a>
        </div>
      </form>

      <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-3 lg:sticky lg:top-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-preview`} className="font-medium">
            Preview{languages.length > 1 && language ? `: ${language.label}` : ""}
          </h2>
          {sendTest && (
            <button
              type="button"
              disabled={testing}
              onClick={() => startTesting(async () => setTestMessage(await sendTest(locale)))}
              className="min-h-10 rounded-md border border-border px-3 text-sm disabled:opacity-50"
            >
              {testing ? "Sending …" : "Send a test to me"}
            </button>
          )}
        </div>
        {testMessage && (
          <p role="status" className={`text-sm ${testMessage.ok ? "" : "text-red-700 dark:text-red-400"}`}>
            {testMessage.message}
          </p>
        )}
        {sendTest && <p className={hint}>The test sends the saved version, with a sample {purpose === "plan" ? "plan" : "cart"}.</p>}
        {preview && (
          <div className="overflow-hidden rounded-lg border border-border bg-background">
            <p className="border-b border-border px-4 py-2 text-sm">
              <span className="text-muted">Subject:</span> {preview.subject}
            </p>
            <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[36rem] w-full bg-white" />
          </div>
        )}
      </section>
    </div>
  );
}
