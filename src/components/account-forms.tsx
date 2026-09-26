"use client";

import { useActionState } from "react";

import {
  deleteAccountAction,
  saveDetailsAction,
  setPasswordAction,
  signOutAction,
  type AccountFormState,
} from "@/app/s/[store]/[market]/account/actions";

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";
const label = "flex flex-col gap-1 text-sm font-medium";
const secondary = "min-h-11 rounded-button border border-border px-5 disabled:opacity-40";
const initial: AccountFormState = { ok: false, message: null };

type Shop = { store: string; market: string };

function Result({ state }: { state: AccountFormState }) {
  return (
    <p role="status" aria-live="polite" className={`text-sm empty:hidden ${state.ok ? "" : "text-red-700 dark:text-red-400"}`}>
      {state.message}
    </p>
  );
}

export type DetailsValues = { name: string; phone: string; line1: string; line2: string; postalCode: string; city: string };

export function DetailsForm({
  store,
  market,
  values,
  labels,
  company,
}: Shop & {
  values: DetailsValues;
  labels: { name: string; phone: string; address: string; addressLine2: string; postalCode: string; city: string; save: string; saving: string };
  /** In stores selling to businesses (B2B): the company the customer buys for. */
  company?: { name: string; number: string; labels: { legend: string; name: string; number: string } };
}) {
  const [state, action, pending] = useActionState(saveDetailsAction.bind(null, store, market), initial);
  const field = (name: keyof DetailsValues, text: string, extra: Record<string, string> = {}) => (
    <label className={label}>
      {text}
      <input name={name} defaultValue={values[name]} className={input} {...extra} />
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {field("name", labels.name, { autoComplete: "name" })}
      {field("phone", labels.phone, { type: "tel", autoComplete: "tel" })}
      {field("line1", labels.address, { autoComplete: "address-line1" })}
      {field("line2", labels.addressLine2, { autoComplete: "address-line2" })}
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        {field("postalCode", labels.postalCode, { autoComplete: "postal-code", inputMode: "numeric" })}
        {field("city", labels.city, { autoComplete: "address-level2" })}
      </div>
      {company && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">{company.labels.legend}</legend>
          <label className={label}>
            {company.labels.name}
            <input name="companyName" defaultValue={company.name} maxLength={120} autoComplete="organization" className={input} />
          </label>
          <label className={label}>
            {company.labels.number}
            <input name="organisationNumber" defaultValue={company.number} maxLength={40} className={input} />
          </label>
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? labels.saving : labels.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function PasswordForm({
  store,
  market,
  email,
  hasPassword,
  labels,
}: Shop & {
  email: string;
  hasPassword: boolean;
  labels: { newPassword: string; rule: string; save: string; remove: string; saving: string };
}) {
  const [state, action, pending] = useActionState(setPasswordAction.bind(null, store, market), initial);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3">
        {/* Lets password managers tie the password to the account. */}
        <input type="email" name="username" value={email} readOnly autoComplete="username" className="sr-only" tabIndex={-1} aria-hidden />
        <label className={label}>
          {labels.newPassword}
          <input name="password" type="password" minLength={12} required autoComplete="new-password" className={input} />
          <span className="font-normal text-muted">{labels.rule}</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={secondary}>
            {pending ? labels.saving : labels.save}
          </button>
          <Result state={state} />
        </div>
      </form>
      {hasPassword && (
        <form action={action}>
          <input type="hidden" name="remove" value="1" />
          <button type="submit" disabled={pending} className="text-sm underline">
            {labels.remove}
          </button>
        </form>
      )}
    </div>
  );
}

export function SignOutButton({ store, market, label: text }: Shop & { label: string }) {
  return (
    <form action={signOutAction.bind(null, store, market)}>
      <button type="submit" className={secondary}>
        {text}
      </button>
    </form>
  );
}

export function DeleteAccountButton({ store, market, labels }: Shop & { labels: { button: string; confirm: string } }) {
  return (
    <form
      action={deleteAccountAction.bind(null, store, market)}
      onSubmit={(event) => {
        if (!window.confirm(labels.confirm)) event.preventDefault();
      }}
    >
      <button type="submit" className="text-sm text-red-700 underline dark:text-red-400">
        {labels.button}
      </button>
    </form>
  );
}

