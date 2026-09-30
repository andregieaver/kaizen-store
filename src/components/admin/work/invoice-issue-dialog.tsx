"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { issueInvoiceAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { Modal } from "@/components/admin/modal";
import { formatMoney } from "@/lib/money";
import { dueOn, formatDay, isDay } from "@/lib/work-dates";
import { readFxRate } from "@/lib/work-invoice-ui";
import type { InvoiceReadiness } from "@/server/work-invoices";

import { ReadinessList } from "./invoice-readiness";
import { Field, Problems, control, hintText, primaryButton, secondaryButton, smallButton } from "./work-parts";

export type IssueDialogProps = {
  open: boolean;
  onClose: () => void;
  storeSlug: string;
  invoiceId: string;
  clientId: string;
  currency: string;
  locale: string;
  /** The total with VAT the person sees: sent back so issuing is refused if it moved. */
  totalMinor: number;
  readiness: InvoiceReadiness | null;
  /** The number it will get, as printed (`W-12`); null when the series cannot be read. */
  nextNumber: string | null;
  /** Today in the store's time zone. */
  today: string;
  /** The days to pay that apply. */
  paymentDays: number;
  /** A suggestion for the exchange rate, from the store's own rates. */
  fxSuggestion: string | null;
  fxRate: string;
  onFxRate: (value: string) => void;
  /** Why issuing must wait (unsaved or unreadable changes); null when nothing does. */
  blocked: string | null;
  /** The checklist changed (the server refused as not ready): read it again. */
  onNotReady: () => void;
};

/**
 * Issuing a draft (docs/work.md 4.4, 4.6): shows the checklist, the number it will get, the issue date (an earlier
 * date than the last invoice's must be confirmed), the exchange rate for a foreign-currency invoice and the total
 * to confirm, and says plainly that the document then cannot be changed, only corrected with a credit note. The
 * server checks everything again and takes the number in one transaction; here the total the person saw goes with
 * it as `expectedTotalMinor`, so an invoice is never issued at an amount they did not see.
 */
export function IssueDialog(props: IssueDialogProps) {
  return (
    <Modal open={props.open} onClose={props.onClose} title="Issue invoice">
      <IssueForm {...props} />
    </Modal>
  );
}

function IssueForm(props: IssueDialogProps) {
  const { storeSlug, invoiceId, currency, locale, totalMinor, readiness, nextNumber, today, paymentDays, blocked } =
    props;
  const id = useId();
  const [issuedOn, setIssuedOn] = useState(today);
  const [confirmedTotal, setConfirmedTotal] = useState(false);
  const [earlierNeeded, setEarlierNeeded] = useState<string | null>(null);
  const [confirmEarlier, setConfirmEarlier] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const { fxRate, onFxRate, fxSuggestion } = props;

  const needsFx = readiness?.needsFxRate ?? false;
  const home = readiness?.homeCurrency ?? "";
  const fx = needsFx ? readFxRate(fxRate) : null;
  const dateProblem = !isDay(issuedOn)
    ? "Give the issue date as a date."
    : issuedOn > today
      ? "The issue date cannot be later than today."
      : null;
  const fxProblem = needsFx && fx === null ? "Enter the exchange rate, such as 11,50." : null;
  const ready = readiness?.ready === true;
  const reasons = [
    blocked,
    !ready ? "Fix what the list above says first." : null,
    dateProblem,
    fxProblem,
    !confirmedTotal ? "Confirm the total." : null,
    earlierNeeded && !confirmEarlier ? "Confirm the earlier date." : null,
  ].filter((r): r is string => Boolean(r));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reasons.length > 0) {
      setProblems(reasons);
      return;
    }
    setProblems([]);
    start(async () => {
      try {
        const result = await issueInvoiceAction(storeSlug, {
          invoiceId,
          issuedOn,
          confirmEarlierDate: confirmEarlier,
          fxRate: fx,
          expectedTotalMinor: totalMinor,
        });
        if (result.ok) {
          props.onClose();
          return;
        }
        if (result.code === "date_before_previous")
          setEarlierNeeded(result.problems[0] ?? "This date is earlier than the last invoice's.");
        else {
          if (result.code === "not_ready") props.onNotReady();
          setProblems(result.problems);
        }
      } catch {
        setProblems(["The invoice could not be issued. Check your connection and try again."]);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-5">
      {readiness && !ready && <ReadinessList readiness={readiness} storeSlug={storeSlug} clientId={props.clientId} />}

      <p className="text-sm">
        {nextNumber ? (
          <>
            It will be issued as <strong>{nextNumber}</strong>.
          </>
        ) : (
          <>It will get the next number in your invoice series.</>
        )}{" "}
        The number is taken when you issue, so deleting a draft never uses one.
      </p>

      <Field
        label="Issue date"
        error={dateProblem ?? undefined}
        hint={`Due ${isDay(issuedOn) && paymentDays > 0 ? `${formatDay(dueOn(issuedOn, paymentDays), locale)} (${paymentDays} days to pay)` : "after the days to pay"}. Today is ${formatDay(today, locale)}.`}
      >
        {(fieldProps) => (
          <input
            {...fieldProps}
            type="date"
            value={issuedOn}
            max={today}
            onChange={(event) => {
              setIssuedOn(event.target.value);
              setEarlierNeeded(null);
              setConfirmEarlier(false);
            }}
            className={`${control} sm:max-w-56`}
          />
        )}
      </Field>

      {earlierNeeded && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
        >
          <p>{earlierNeeded}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmEarlier}
              onChange={(event) => setConfirmEarlier(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>Issue the invoice with this earlier date anyway.</span>
          </label>
        </div>
      )}

      {needsFx && (
        <Field
          label={`Exchange rate: 1 ${currency} in ${home}`}
          error={fxProblem ?? undefined}
          hint={`The VAT is also stated in ${home}. Use the European Central Bank's reference rate for the issue date.`}
        >
          {(fieldProps) => (
            <div className="flex flex-wrap items-center gap-2">
              <input
                {...fieldProps}
                value={fxRate}
                onChange={(event) => onFxRate(event.target.value)}
                inputMode="decimal"
                autoComplete="off"
                className={`${control} max-w-40`}
              />
              {fxSuggestion && (
                <button type="button" onClick={() => onFxRate(fxSuggestion)} className={smallButton}>
                  Use {fxSuggestion}
                </button>
              )}
            </div>
          )}
        </Field>
      )}

      <div className="flex flex-col gap-2 rounded-md bg-surface p-3 text-sm">
        <p>
          The total with VAT is <strong className="tabular-nums">{formatMoney(totalMinor, currency, locale)}</strong>.
        </p>
        <label className="flex items-start gap-2" htmlFor={`${id}-total`}>
          <input
            id={`${id}-total`}
            type="checkbox"
            checked={confirmedTotal}
            onChange={(event) => setConfirmedTotal(event.target.checked)}
            className="mt-0.5 size-4"
          />
          <span>I have checked the lines and the total.</span>
        </label>
      </div>

      <p className={hintText}>
        Once issued, the invoice cannot be changed or deleted. Its number, lines, amounts and the seller&apos;s and
        client&apos;s details are kept as they are. A mistake is corrected with a credit note, which only an owner can
        issue, and a new invoice.
      </p>

      {reasons.length > 0 && problems.length === 0 && (
        <p className="text-sm text-muted" aria-live="polite">
          Not yet: {reasons.join(" ")}
        </p>
      )}
      <Problems messages={problems} />

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={props.onClose} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={pending || reasons.length > 0} className={primaryButton}>
          {pending ? "Issuing …" : nextNumber ? `Issue as ${nextNumber}` : "Issue invoice"}
        </button>
      </div>
    </form>
  );
}
