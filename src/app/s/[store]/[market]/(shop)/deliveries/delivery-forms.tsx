"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import type { AddressState, StartState } from "./actions";

export type AddressValues = { name: string; line1: string; line2: string; postalCode: string; city: string; phone: string };

type AddressLabels = { name: string; line1: string; line2: string; postalCode: string; city: string; phone: string };

const field = "min-h-11 rounded-button border border-border bg-background px-3";

function AddressFields({ values, labels }: { values: AddressValues; labels: AddressLabels }) {
  const input = (name: keyof AddressValues, autoComplete: string, required = true) => (
    <label className="flex flex-col gap-1 text-sm">
      {labels[name]}
      <input name={name} defaultValue={values[name]} autoComplete={autoComplete} required={required} className={field} />
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">{input("name", "name")}</div>
      <div className="sm:col-span-2">{input("line1", "address-line1")}</div>
      <div className="sm:col-span-2">{input("line2", "address-line2", false)}</div>
      {input("postalCode", "postal-code")}
      {input("city", "address-level2")}
      <div className="sm:col-span-2">{input("phone", "tel", false)}</div>
    </div>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" disabled={busy} className="min-h-11 button-primary px-5 text-sm font-medium disabled:opacity-50">
      {busy ? pending : label}
    </button>
  );
}

/** Starting a weekly delivery, or changing its day, address and card (D102): agreement, then Stripe saves the card. */
export function DeliverySetupForm({
  action,
  schedules,
  chosen,
  address,
  labels,
}: {
  action: (state: StartState, form: FormData) => Promise<StartState>;
  schedules: { id: string; label: string }[];
  chosen: string | null;
  address: AddressValues;
  labels: AddressLabels & {
    deliveryDay: string;
    address: string;
    consent: string;
    submit: string;
    saving: string;
    problems: Record<string, string>;
  };
}) {
  const [state, formAction] = useActionState(action, { problem: null });
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{labels.deliveryDay}</legend>
        {schedules.map((schedule, i) => (
          <label key={schedule.id} className="flex min-h-11 items-center gap-3 rounded-button border border-border px-3 has-checked:border-foreground">
            <input type="radio" name="scheduleId" value={schedule.id} defaultChecked={chosen ? chosen === schedule.id : i === 0} required />
            {schedule.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{labels.address}</legend>
        <AddressFields values={address} labels={labels} />
      </fieldset>
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="consent" required className="mt-0.5 size-4" />
        <span>{labels.consent}</span>
      </label>
      {state.problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {labels.problems[state.problem] ?? labels.problems.payment_error}
        </p>
      )}
      <div>
        <Submit label={labels.submit} pending={labels.saving} />
      </div>
    </form>
  );
}

/** The delivery address of a running list. */
export function DeliveryAddressForm({
  action,
  address,
  labels,
}: {
  action: (state: AddressState, form: FormData) => Promise<AddressState>;
  address: AddressValues;
  labels: AddressLabels & { save: string; saving: string; saved: string; tryAgain: string };
}) {
  const [state, formAction] = useActionState(action, { ok: null });
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <AddressFields values={address} labels={labels} />
      <div className="flex flex-wrap items-center gap-3">
        <Submit label={labels.save} pending={labels.saving} />
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {state.ok === true ? labels.saved : state.ok === false ? labels.tryAgain : ""}
        </p>
      </div>
    </form>
  );
}

/** A button that asks first, such as ending the weekly delivery. */
export function ConfirmButton({ action, label, question }: { action: () => Promise<void>; label: string; question: string }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(question)) event.preventDefault();
      }}
    >
      <button type="submit" className="min-h-11 rounded-button px-3 text-sm underline">
        {label}
      </button>
    </form>
  );
}
