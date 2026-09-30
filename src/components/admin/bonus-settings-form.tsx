"use client";

import { useState, useTransition, type ReactNode } from "react";

import {
  BONUS_EXPLANATION,
  BONUS_OFF_NOTE,
  BONUS_ON_NOTES,
  earnExample,
  formFromSettings,
  moneyIn,
  orderedProblems,
  readBonusForm,
  rulesSummary,
  type BonusField,
  type BonusFormValues,
} from "@/lib/bonus-admin";
import type { BonusResult, BonusSettings } from "@/lib/bonus";

const control =
  "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm aria-invalid:border-red-700 dark:aria-invalid:border-red-400 disabled:opacity-60";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const errorText = "text-sm text-red-700 dark:text-red-400";

type Errors = Partial<Record<BonusField, string>>;

/**
 * The bonus program's settings (D130). Everything is typed as text and read with the same schema the server uses, so a
 * problem is shown beside its field, with the first one focused. Staff see the program read-only; only an owner saves.
 */
export function BonusSettingsForm({
  initial,
  currency,
  locale,
  canEdit,
  save,
}: {
  initial: BonusSettings;
  currency: string;
  locale: string;
  canEdit: boolean;
  save: (raw: unknown) => Promise<BonusResult>;
}) {
  const [values, setValues] = useState<BonusFormValues>(() => formFromSettings(initial, currency));
  const [errors, setErrors] = useState<Errors>({});
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [savedOn, setSavedOn] = useState(initial.enabled);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof BonusFormValues>(key: K, value: BonusFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(null);
  };

  // What the draft would be, for the example and the summary; while a field is wrong, the last good reading stays.
  const draft = readBonusForm(values, currency);
  const [lastGood, setLastGood] = useState<BonusSettings>(initial);
  if (draft.ok && JSON.stringify(draft.settings) !== JSON.stringify(lastGood)) setLastGood(draft.settings);
  const shown = draft.ok ? draft.settings : lastGood;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaved(null);
    setServerProblems([]);
    const read = readBonusForm(values, currency);
    if (!read.ok) {
      setErrors(read.errors);
      const first = orderedProblems(read.errors)[0];
      if (first) window.setTimeout(() => document.getElementById(`bonus-${first.field}`)?.focus(), 0);
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
          ? "Saved. The bonus program is on: signed-in customers earn credits on the orders they pay from now. Existing customers start at zero."
          : read.settings.enabled
            ? "Saved. The new rules count from now."
            : "Saved. The bonus program is off. Balances are kept.",
      );
    });
  }

  return (
    <BonusSettingsView
      values={values}
      errors={errors}
      serverProblems={serverProblems}
      saved={saved}
      savedOn={savedOn}
      pending={pending}
      canEdit={canEdit}
      currency={currency}
      locale={locale}
      shown={shown}
      complete={draft.ok}
      onChange={set}
      onSubmit={submit}
    />
  );
}

export type BonusSettingsViewProps = {
  values: BonusFormValues;
  errors: Errors;
  serverProblems: string[];
  saved: string | null;
  /** The program is on as saved (not as typed). */
  savedOn: boolean;
  pending: boolean;
  canEdit: boolean;
  currency: string;
  locale: string;
  /** The rules the example and the summary show: the draft, or the last complete one while a field is wrong. */
  shown: BonusSettings;
  /** The draft is complete (every field readable). */
  complete: boolean;
  onChange: <K extends keyof BonusFormValues>(key: K, value: BonusFormValues[K]) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

/** The form as drawn from its state, so every state can be seen without a browser. */
export function BonusSettingsView({
  values,
  errors,
  serverProblems,
  saved,
  savedOn,
  pending,
  canEdit,
  currency,
  locale,
  shown,
  complete,
  onChange: set,
  onSubmit,
}: BonusSettingsViewProps) {
  const money = moneyIn(currency, locale);
  const example = earnExample(shown.earnBps, currency, locale);
  const problems = orderedProblems(errors);

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6 border-0 p-0">
        <div className={card} role="group" aria-labelledby="bonus-switch-heading">
          <h2 id="bonus-switch-heading" className="font-medium">
            Bonus program
          </h2>
          <p className="text-sm text-muted">{BONUS_EXPLANATION}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="bonus-enabled"
              type="checkbox"
              checked={values.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              aria-describedby="bonus-enabled-notes"
              className="mt-0.5 size-4"
            />
            <span className="font-medium">The bonus program is on</span>
          </label>
          <div id="bonus-enabled-notes" className="rounded-md bg-surface p-3 text-sm">
            {values.enabled ? (
              <>
                <p className="mb-1 font-medium">{savedOn ? "While it is on" : "When you turn it on"}</p>
                <ul className="list-disc pl-5">
                  {BONUS_ON_NOTES.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{savedOn ? BONUS_OFF_NOTE : "It is off. Nothing is earned or used, and shoppers see no credits."}</p>
            )}
          </div>
        </div>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">Earning credits</legend>
          <Field
            id="bonus-earnPercent"
            label="Credits back"
            suffix="%"
            error={errors.earnPercent}
            hint={
              <>
                Of what the customer pays online for goods: shipping, anything paid at a venue and the credits they used
                do not count. Nothing is earned on free gifts.{" "}
                <strong className="font-medium">{example.sentence}</strong>
              </>
            }
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.earnPercent}
                onChange={(event) => set("earnPercent", event.target.value)}
                className={control}
              />
            )}
          </Field>
          <Field
            id="bonus-pendingDays"
            label="Wait before credits can be used"
            suffix="days"
            error={errors.pendingDays}
            hint="The return period: credits earned on an order wait this long after it is paid, so a return does not leave you paying out credits. Use 0 to allow use at once."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.pendingDays}
                onChange={(event) => set("pendingDays", event.target.value)}
                className={control}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">Using credits</legend>
          <Field
            id="bonus-maxRedeemPercent"
            label="The most of an order's goods credits can pay"
            suffix="%"
            error={errors.maxRedeemPercent}
            hint="Credits take money off goods only, never shipping, and always leave something to pay online, so the order still goes through the normal payment. It is worked out on the goods left after campaigns, customer group discounts and codes."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={values.maxRedeemPercent}
                onChange={(event) => set("maxRedeemPercent", event.target.value)}
                className={control}
              />
            )}
          </Field>
          <Field
            id="bonus-minRedeem"
            label="Least credits to use at once"
            suffix={currency}
            error={errors.minRedeem}
            hint="Leave empty for no minimum. A customer with less than this cannot use their credits yet."
          >
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.minRedeem}
                onChange={(event) => set("minRedeem", event.target.value)}
                className={control}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">Expiry</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="bonus-expires"
              type="checkbox"
              checked={values.expires}
              onChange={(event) => set("expires", event.target.checked)}
              aria-describedby="bonus-expires-hint"
              className="mt-0.5 size-4"
            />
            <span>Credits that are not used expire</span>
          </label>
          <p id="bonus-expires-hint" className="text-sm text-muted">
            Left off, credits last for ever. When they expire, the oldest credits are used first and expire first, and
            the customer is emailed a reminder before their credits run out.
          </p>
          {values.expires && (
            <Field
              id="bonus-expiresMonths"
              label="Expire after"
              suffix="months"
              error={errors.expiresMonths}
              hint="Counted from the day the credits are earned."
            >
              {(props) => (
                <input
                  {...props}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={values.expiresMonths}
                  onChange={(event) => set("expiresMonths", event.target.value)}
                  className={control}
                />
              )}
            </Field>
          )}
        </fieldset>
      </fieldset>

      <section aria-labelledby="bonus-summary-heading" className={card}>
        <h2 id="bonus-summary-heading" className="font-medium">
          What shoppers will read
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {rulesSummary(shown, money, currency).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {!complete && (
          <p className="text-sm text-muted">
            This shows the last rules that were complete. Fix the marked fields to update it.
          </p>
        )}
        {!shown.enabled && <p className="text-sm text-muted">The program is off, so shoppers see none of this yet.</p>}
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
                    href={`#bonus-${field}`}
                    className="underline"
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`bonus-${field}`)?.focus();
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
        <p className="text-sm text-muted">Only an owner can change the bonus program. You can see how it is set up.</p>
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
