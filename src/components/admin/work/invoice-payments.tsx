"use client";

import { useState, useTransition, type FormEvent } from "react";

import { recordPaymentAction, reversePaymentAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { Modal } from "@/components/admin/modal";
import { formatMoney } from "@/lib/money";
import { MANUAL_PAYMENT_METHODS } from "@/lib/work-input";
import { minorToDecimal } from "@/lib/work-calc";
import { isDay } from "@/lib/work-dates";
import { methodLabel, paymentAmountProblem } from "@/lib/work-invoice-ui";

import { Field, Problems, control, primaryButton, secondaryButton, smallButton } from "./work-parts";

/**
 * Recording money received and taking a payment back (docs/work.md 4.6): payments are rows, never edits. A partial
 * payment is fine; more than what is outstanding is refused. Taking one back adds a reversing row and the invoice
 * goes back to issued if it no longer covers the total. The server checks everything again.
 */

export function RecordPaymentButton({
  storeSlug,
  invoiceId,
  currency,
  locale,
  outstandingMinor,
  today,
}: {
  storeSlug: string;
  invoiceId: string;
  currency: string;
  locale: string;
  outstandingMinor: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={primaryButton}>
        Record payment
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record payment">
        <PaymentForm
          storeSlug={storeSlug}
          invoiceId={invoiceId}
          currency={currency}
          locale={locale}
          outstandingMinor={outstandingMinor}
          today={today}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function PaymentForm({
  storeSlug,
  invoiceId,
  currency,
  locale,
  outstandingMinor,
  today,
  onDone,
}: {
  storeSlug: string;
  invoiceId: string;
  currency: string;
  locale: string;
  outstandingMinor: number;
  today: string;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(minorToDecimal(outstandingMinor, currency));
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]>("bank");
  const [reference, setReference] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [pending, start] = useTransition();

  const read = paymentAmountProblem(amount, currency, outstandingMinor);
  const dateProblem = !isDay(receivedOn)
    ? "Give the date it was received."
    : receivedOn > today
      ? "The payment cannot be dated in the future."
      : null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (read.minor === null || dateProblem) return;
    setProblems([]);
    const amountMinor = read.minor;
    start(async () => {
      try {
        const result = await recordPaymentAction(storeSlug, { invoiceId, amountMinor, receivedOn, method, reference });
        if (result.ok) onDone();
        else setProblems(result.problems);
      } catch {
        setProblems(["The payment could not be recorded. Check your connection and try again."]);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-4">
      <p className="text-sm">
        Outstanding: <strong className="tabular-nums">{formatMoney(outstandingMinor, currency, locale)}</strong>. A part
        payment is fine; the invoice is marked paid when the payments cover it.
      </p>
      <Field label={`Amount received (${currency})`} error={attempted ? (read.message ?? undefined) : undefined}>
        {(props) => (
          <input
            {...props}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className={`${control} sm:max-w-56`}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Received on" error={attempted ? (dateProblem ?? undefined) : undefined}>
          {(props) => (
            <input
              {...props}
              type="date"
              value={receivedOn}
              max={today}
              onChange={(event) => setReceivedOn(event.target.value)}
              className={control}
            />
          )}
        </Field>
        <Field label="Method">
          {(props) => (
            <select
              {...props}
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
              className={control}
            >
              {MANUAL_PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {methodLabel(value)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Reference (optional)" hint="Such as the bank's reference or the last digits of the account.">
        {(props) => (
          <input
            {...props}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            maxLength={200}
            autoComplete="off"
            className={control}
          />
        )}
      </Field>
      <Problems messages={problems} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDone} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Recording …" : "Record payment"}
        </button>
      </div>
    </form>
  );
}

export function ReversePaymentButton({
  storeSlug,
  paymentId,
  label,
}: {
  storeSlug: string;
  paymentId: string;
  /** What the payment is, for the button's name: "the 1 250,00 kr payment of 12.09.2026". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProblems([]);
    start(async () => {
      try {
        const result = await reversePaymentAction(storeSlug, { paymentId, reason });
        if (result.ok) setOpen(false);
        else setProblems(result.problems);
      } catch {
        setProblems(["The payment could not be reversed. Check your connection and try again."]);
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Reverse ${label}`} className={smallButton}>
        Reverse
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reverse this payment?">
        <form onSubmit={submit} aria-busy={pending} className="flex flex-col gap-4">
          <p className="text-sm">
            This takes back {label}. The payment stays in the list, with a reversal beside it, and the invoice goes back
            to issued if it is no longer covered.
          </p>
          <Field label="Why (optional)">
            {(props) => (
              <input
                {...props}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                autoComplete="off"
                className={control}
              />
            )}
          </Field>
          <Problems messages={problems} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              Keep the payment
            </button>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? "Reversing …" : "Reverse payment"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
