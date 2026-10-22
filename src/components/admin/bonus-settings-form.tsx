"use client";

import { useState, useTransition, type ReactNode } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import {
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
  "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm aria-invalid:border-danger-text disabled:opacity-60";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const errorText = "text-sm text-danger-text";

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
  const w = useAdminText("loyalty").bonus;

  const set = <K extends keyof BonusFormValues>(key: K, value: BonusFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(null);
  };

  // What the draft would be, for the example and the summary; while a field is wrong, the last good reading stays.
  const draft = readBonusForm(values, currency, w.errors);
  const [lastGood, setLastGood] = useState<BonusSettings>(initial);
  if (draft.ok && JSON.stringify(draft.settings) !== JSON.stringify(lastGood)) setLastGood(draft.settings);
  const shown = draft.ok ? draft.settings : lastGood;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    setSaved(null);
    setServerProblems([]);
    const read = readBonusForm(values, currency, w.errors);
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
      setSaved(turnedOn ? w.savedOn : read.settings.enabled ? w.savedRules : w.savedOff);
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
  const words = useAdminText("loyalty");
  const w = words.bonus;
  const money = moneyIn(currency, locale);
  const example = earnExample(shown.earnBps, currency, locale, 1000, w.example);
  const problems = orderedProblems(errors);

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={pending} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-6 border-0 p-0">
        <div className={card} role="group" aria-labelledby="bonus-switch-heading">
          <h2 id="bonus-switch-heading" className="text-title text-ink">
            {w.heading}
          </h2>
          <p className="text-sm text-muted">{w.explanation}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="bonus-enabled"
              type="checkbox"
              checked={values.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              aria-describedby="bonus-enabled-notes"
              className="mt-0.5 size-4"
            />
            <span className="font-medium">{w.switch}</span>
          </label>
          <div id="bonus-enabled-notes" className="rounded-md bg-sunken p-3 text-sm">
            {values.enabled ? (
              <>
                <p className="mb-1 font-medium">{savedOn ? w.whileOn : w.whenOn}</p>
                <ul className="list-disc pl-5">
                  {w.onNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{savedOn ? w.offNote : w.offFresh}</p>
            )}
          </div>
        </div>

        <fieldset className={card}>
          <legend className="float-left mb-0 w-full font-medium">{w.earning}</legend>
          <Field
            id="bonus-earnPercent"
            label={w.earnLabel}
            suffix="%"
            error={errors.earnPercent}
            hint={
              <>
                {w.earnHint}{" "}
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
            label={w.pendingLabel}
            suffix={w.daysUnit}
            error={errors.pendingDays}
            hint={w.pendingHint}
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
          <legend className="float-left mb-0 w-full font-medium">{w.using}</legend>
          <Field
            id="bonus-maxRedeemPercent"
            label={w.maxLabel}
            suffix="%"
            error={errors.maxRedeemPercent}
            hint={w.maxHint}
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
            label={w.minLabel}
            suffix={currency}
            error={errors.minRedeem}
            hint={w.minHint}
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
          <legend className="float-left mb-0 w-full font-medium">{w.expiry}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              id="bonus-expires"
              type="checkbox"
              checked={values.expires}
              onChange={(event) => set("expires", event.target.checked)}
              aria-describedby="bonus-expires-hint"
              className="mt-0.5 size-4"
            />
            <span>{w.expiresLabel}</span>
          </label>
          <p id="bonus-expires-hint" className="text-sm text-muted">
            {w.expiresHint}
          </p>
          {values.expires && (
            <Field
              id="bonus-expiresMonths"
              label={w.expireAfter}
              suffix={w.monthsUnit}
              error={errors.expiresMonths}
              hint={w.expireAfterHint}
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
        <h2 id="bonus-summary-heading" className="text-title text-ink">
          {w.summaryHeading}
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {rulesSummary(shown, money, currency, words.bonusRules).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {!complete && (
          <p className="text-sm text-muted">{w.incomplete}</p>
        )}
        {!shown.enabled && <p className="text-sm text-muted">{w.offSummary}</p>}
      </section>

      <div role="alert" className={errorText}>
        {(problems.length > 0 || serverProblems.length > 0) && (
          <>
            <p className="font-medium">
              {problems.length > 0 ? words.common.notSavedFix : words.common.notSaved}
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
            className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40"
          >
            {pending ? words.common.saving : words.common.save}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">{w.readOnly}</p>
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
