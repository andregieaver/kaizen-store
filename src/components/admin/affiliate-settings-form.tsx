"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  AFFILIATE_EXPLANATION,
  AFFILIATE_NEEDS_BONUS,
  AFFILIATE_OFF_NOTE,
  AFFILIATE_ON_NOTES,
  example,
  formFromSettings,
  orderedProblems,
  readAffiliateForm,
  rulesSummary,
  type AffiliateField,
  type AffiliateFormValues,
} from "@/lib/affiliate-admin";
import type { AffiliateResult, AffiliateSettings } from "@/lib/affiliates";
import { moneyIn } from "@/lib/bonus-admin";

const control =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700 dark:aria-invalid:border-red-400 disabled:opacity-60";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const errorText = "text-sm text-red-700 dark:text-red-400";

type Errors = Partial<Record<AffiliateField, string>>;

/**
 * The store's referral program (D131). Everything is typed as text and read with the same schema the server uses, so a
 * problem is shown beside its field, with the first one focused. The program needs the bonus program: while that is off it
 * cannot be switched on, and the page says why. Staff see the program read-only; only an owner saves.
 */
export function AffiliateSettingsForm({
  initial,
  currency,
  locale,
  bonusOn,
  pendingDays,
  canEdit,
  save,
}: {
  initial: AffiliateSettings;
  /** The credits' currency: the amounts are in it. */
  currency: string;
  locale: string;
  bonusOn: boolean;
  /** The bonus program's wait before credits can be used, for the summary. */
  pendingDays: number;
  canEdit: boolean;
  save: (raw: unknown) => Promise<AffiliateResult>;
}) {
  const [values, setValues] = useState<AffiliateFormValues>(() => formFromSettings(initial, currency));
  const [errors, setErrors] = useState<Errors>({});
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [savedOn, setSavedOn] = useState(initial.enabled);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof AffiliateFormValues>(key: K, value: AffiliateFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(null);
  };

  // What the draft would be, for the example and the summary; while a field is wrong, the last good reading stays.
  const draft = readAffiliateForm(values, currency);
  const [lastGood, setLastGood] = useState<AffiliateSettings>(initial);
  if (draft.ok && JSON.stringify(draft.settings) !== JSON.stringify(lastGood)) setLastGood(draft.settings);
  const shown = draft.ok ? draft.settings : lastGood;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaved(null);
    setServerProblems([]);
    const read = readAffiliateForm(values, currency);
    if (!read.ok) {
      setErrors(read.errors);
      const first = orderedProblems(read.errors)[0];
      if (first) window.setTimeout(() => document.getElementById(`affiliate-${first.field}`)?.focus(), 0);
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await save(read.settings);
      if (!result.ok) {
        setServerProblems(result.problems);
        return;
      }
      setValues(formFromSettings(read.settings, currency));
      const turnedOn = read.settings.enabled && !savedOn;
      setSavedOn(read.settings.enabled);
      setSaved(
        turnedOn
          ? "Saved. The referral program is on: signed-in customers can now open Refer a friend in My account and share their link."
          : read.settings.enabled
            ? "Saved. The new rules count from now."
            : "Saved. The referral program is off. Credits already earned are kept.",
      );
    });
  }

  return (
    <AffiliateSettingsView
      values={values}
      errors={errors}
      serverProblems={serverProblems}
      saved={saved}
      savedOn={savedOn}
      pending={pending}
      canEdit={canEdit}
      currency={currency}
      locale={locale}
      bonusOn={bonusOn}
      pendingDays={pendingDays}
      shown={shown}
      complete={draft.ok}
      onChange={set}
      onSubmit={submit}
    />
  );
}

export type AffiliateSettingsViewProps = {
  values: AffiliateFormValues;
  errors: Errors;
  serverProblems: string[];
  saved: string | null;
  /** The program is on as saved (not as typed). */
  savedOn: boolean;
  pending: boolean;
  canEdit: boolean;
  currency: string;
  locale: string;
  /** The bonus program is on: without it the referral program cannot be switched on. */
  bonusOn: boolean;
  pendingDays: number;
  /** The rules the example and the summary show: the draft, or the last complete one while a field is wrong. */
  shown: AffiliateSettings;
  complete: boolean;
  onChange: <K extends keyof AffiliateFormValues>(key: K, value: AffiliateFormValues[K]) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

/** The form as drawn from its state, so every state can be seen without a browser. */
export function AffiliateSettingsView({
  values,
  errors,
  serverProblems,
  saved,
  savedOn,
  pending,
  canEdit,
  currency,
  locale,
  bonusOn,
  pendingDays,
  shown,
  complete,
  onChange: set,
  onSubmit,
}: AffiliateSettingsViewProps) {
  const money = moneyIn(currency, locale);
  const problems = orderedProblems(errors);
  // A program that is on keeps its switch usable, so it can be turned off whatever the bonus program is doing.
  const cannotTurnOn = !bonusOn && !values.enabled;

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6 border-0 p-0">
        <div className={card} role="group" aria-labelledby="affiliate-switch-heading">
          <h2 id="affiliate-switch-heading" className="font-medium">
            Referral program
          </h2>
          <p className="text-sm text-muted">{AFFILIATE_EXPLANATION}</p>
          {!bonusOn && (
            <p role="note" className="rounded-md border border-border bg-surface p-3 text-sm">
              {AFFILIATE_NEEDS_BONUS}
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              id="affiliate-enabled"
              type="checkbox"
              checked={values.enabled}
              disabled={cannotTurnOn}
              onChange={(event) => set("enabled", event.target.checked)}
              aria-describedby="affiliate-enabled-notes"
              className="mt-0.5 size-4"
            />
            <span className="font-medium">The referral program is on</span>
          </label>
          <div id="affiliate-enabled-notes" className="rounded-md bg-surface p-3 text-sm">
            {values.enabled ? (
              <>
                <p className="mb-1 font-medium">{savedOn ? "While it is on" : "When you turn it on"}</p>
                <ul className="list-disc pl-5">
                  {AFFILIATE_ON_NOTES.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{savedOn ? AFFILIATE_OFF_NOTE : "It is off. Nobody has a link, and shoppers see nothing about it."}</p>
            )}
          </div>
        </div>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">The friend&apos;s welcome discount</legend>
          <Field
            id="affiliate-friendPercent"
            label="Discount on the goods in their first order"
            suffix="%"
            error={errors.friendPercent}
            hint="Off the goods after campaigns and customer group discounts, before discount codes and bonus credits. Use 0 for no discount. A friend must be signed in, and it is only for their first paid order."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.friendPercent}
                onChange={(event) => set("friendPercent", event.target.value)}
                className={control}
              />
            )}
          </Field>
          <Field
            id="affiliate-friendMax"
            label="The most it takes off"
            suffix={currency}
            error={errors.friendMax}
            hint="Leave empty for no limit."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.friendMax}
                onChange={(event) => set("friendMax", event.target.value)}
                className={control}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">What the customer who shared the link earns</legend>
          <Field
            id="affiliate-rewardPercent"
            label="Bonus credits"
            suffix="%"
            error={errors.rewardPercent}
            hint="Of what the friend pays online for goods: shipping, anything paid at a venue and the credits or discounts they used do not count. The credits wait the bonus program's return period, then expire as its settings say."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.rewardPercent}
                onChange={(event) => set("rewardPercent", event.target.value)}
                className={control}
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="affiliate-rewardScope"
              type="checkbox"
              checked={values.rewardScope === "limited"}
              onChange={(event) => set("rewardScope", event.target.checked ? "limited" : "every")}
              className="mt-0.5 size-4"
            />
            <span>Only the friend&apos;s first orders earn credits</span>
          </label>
          {values.rewardScope === "limited" && (
            <Field
              id="affiliate-rewardOrders"
              label="How many of the friend's orders earn credits"
              suffix="orders"
              error={errors.rewardOrders}
              hint="1 is only the first order, which is also the one with the welcome discount."
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={values.rewardOrders}
                  onChange={(event) => set("rewardOrders", event.target.value)}
                  className={control}
                />
              )}
            </Field>
          )}
          <Field
            id="affiliate-monthlyCap"
            label="The most one customer earns a month"
            suffix={currency}
            error={errors.monthlyCap}
            hint="Counted per calendar month in the store's time zone. Credits past it are not given, and the order is marked so. Leave empty for no limit."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.monthlyCap}
                onChange={(event) => set("monthlyCap", event.target.value)}
                className={control}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">The link</legend>
          <Field
            id="affiliate-cookieDays"
            label="How long a visitor's link is remembered"
            suffix="days"
            error={errors.cookieDays}
            hint="Only for visitors who allow marketing cookies; the last link they opened counts. Others keep the link until they leave the site."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.cookieDays}
                onChange={(event) => set("cookieDays", event.target.value)}
                className={control}
              />
            )}
          </Field>
        </fieldset>
      </fieldset>

      <section aria-labelledby="affiliate-summary-heading" className={card}>
        <h2 id="affiliate-summary-heading" className="font-medium">
          What it comes to
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {rulesSummary(shown, money, pendingDays).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm">
          <strong className="font-medium">{example(shown, currency, locale)}</strong>
        </p>
        {!complete && (
          <p className="text-sm text-muted">This shows the last rules that were complete. Fix the marked fields to update it.</p>
        )}
      </section>

      <div role="alert" className={errorText}>
        {(problems.length > 0 || serverProblems.length > 0) && (
          <>
            <p className="font-medium">
              {problems.length > 0 ? "The settings were not saved. Fix this:" : "The settings were not saved:"}
            </p>
            <ul className="list-disc pl-5">
              {problems.map(({ field, message }) => (
                <li key={field}>
                  <a
                    href={`#affiliate-${field}`}
                    className="underline"
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`affiliate-${field}`)?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
              {serverProblems.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {saved && <p>{saved}</p>}
      </div>

      {canEdit ? (
        <div>
          <button
            type="submit"
            disabled={pending}
            className="min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40"
          >
            {pending ? "Saving …" : "Save"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">Only an owner can change the referral program. You can see how it is set up.</p>
      )}
    </form>
  );
}

/** A labelled number field with its unit, helper text and error, wired for screen readers. */
function Field({
  id,
  label,
  suffix,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  suffix: string;
  hint: ReactNode;
  error: string | undefined;
  children: (props: { id: string; "aria-invalid": true | undefined; "aria-describedby": string }) => ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex max-w-xl flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
        <span className="sr-only"> ({suffix})</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="w-32 shrink-0">
          {children({
            id,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": error ? `${errorId} ${hintId}` : hintId,
          })}
        </div>
        <span aria-hidden="true" className="text-muted">
          {suffix}
        </span>
      </div>
      {error && (
        <p id={errorId} className={errorText}>
          {error}
        </p>
      )}
      <p id={hintId} className="text-muted">
        {hint}
      </p>
    </div>
  );
}
