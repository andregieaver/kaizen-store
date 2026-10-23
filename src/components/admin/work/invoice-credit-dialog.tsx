"use client";

import { useId, useState, useTransition, type FormEvent } from "react";

import { creditInvoiceAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { Modal } from "@/components/admin/modal";
import { formatMoney } from "@/lib/money";
import { MANUAL_PAYMENT_METHODS } from "@/lib/work-input";
import { formatDay, isDay } from "@/lib/work-dates";
import {
  creditableOf,
  methodLabel,
  quantityField,
  readCreditLines,
  refundable,
  type CreditChoice,
} from "@/lib/work-invoice-ui";
import type { CreditNoteSummary, InvoiceAmounts, InvoiceLine } from "@/server/work-invoices";

import { Field, Problems, control, hintText, primaryButton, secondaryButton } from "./work-parts";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

export type CreditDialogProps = {
  storeSlug: string;
  invoiceId: string;
  documentNumber: string;
  currency: string;
  locale: string;
  lines: InvoiceLine[];
  creditNotes: CreditNoteSummary[];
  amounts: InvoiceAmounts;
  today: string;
  /** Only an owner can credit an invoice (docs/work.md 4.9): others see why the button is off. */
  isOwner: boolean;
};

/**
 * The button that opens the credit note dialog, for owners; for anyone else it is off and says why. A credit note
 * corrects an issued invoice without changing it (docs/work.md 4.6): the whole of what is left (which voids the
 * invoice and frees its time) or chosen lines and quantities, with a reason that is printed on it, and, when money
 * was received, an optional recording of the refund.
 */
export function CreditInvoiceButton(props: CreditDialogProps) {
  const tw = useAdminText("work").invoiceCreditDialog;
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  if (!props.isOwner) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" disabled aria-describedby={reasonId} className={secondaryButton}>
          {tw.creditInvoice}
        </button>
        <p id={reasonId} className={hintText}>
          {tw.onlyAnOwnerCan}
        </p>
      </div>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
        {tw.creditInvoice}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Credit invoice ${props.documentNumber}`} wide>
        <CreditForm {...props} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function CreditForm({
  storeSlug,
  invoiceId,
  currency,
  locale,
  lines,
  creditNotes,
  amounts,
  today,
  onDone,
}: CreditDialogProps & { onDone: () => void }) {
  const tw = useAdminText("work").invoiceCreditDialog;
  const [kind, setKind] = useState<"full" | "partial">("full");
  const [reason, setReason] = useState("");
  const [choices, setChoices] = useState<CreditChoice[]>([]);
  const [issuedOn, setIssuedOn] = useState(today);
  const [earlierNeeded, setEarlierNeeded] = useState<string | null>(null);
  const [confirmEarlier, setConfirmEarlier] = useState(false);
  const [refund, setRefund] = useState(false);
  const [method, setMethod] = useState<(typeof MANUAL_PAYMENT_METHODS)[number]>("bank");
  const [refundRef, setRefundRef] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const left = lines.map((line) => ({ line, left: creditableOf(line, creditNotes) }));
  const creditable = left.filter((entry) => entry.left.quantityHundredths > 0);
  const fullTotal = creditable.reduce((sum, entry) => sum + entry.left.inclMinor, 0);

  const partial = readCreditLines(lines, creditNotes, choices);
  const total = kind === "full" ? fullTotal : partial.ok ? partial.inclMinor : 0;
  const canRefund = refundable(amounts, total);

  const reasonProblem =
    reason.trim() === "" ? tw.sayWhyTheInvoice : null;
  const dateProblem = !isDay(issuedOn)
    ? tw.giveTheDateAs
    : issuedOn > today
      ? tw.theDateCannotBe
      : null;
  const partialProblem = kind === "partial" && !partial.ok ? partial : null;

  const setQuantity = (lineId: string, quantity: string) =>
    setChoices((current) => [...current.filter((c) => c.lineId !== lineId), { lineId, quantity }]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    if (reasonProblem || dateProblem || (kind === "partial" && !partial.ok) || (earlierNeeded && !confirmEarlier))
      return;
    setProblems([]);
    start(async () => {
      try {
        const result = await creditInvoiceAction(storeSlug, {
          invoiceId,
          reason: reason.trim(),
          kind,
          lines: kind === "partial" && partial.ok ? partial.lines : [],
          issuedOn,
          confirmEarlierDate: confirmEarlier,
          refund: refund && canRefund > 0 ? { method, reference: refundRef.trim() || null } : null,
        });
        if (result.ok) onDone();
        else if (result.code === "date_before_previous")
          setEarlierNeeded(result.problems[0] ?? tw.thisDateIsEarlier);
        else setProblems(result.problems);
      } catch {
        setProblems([tw.theCreditNoteCould]);
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending} className="flex flex-col gap-5">
      <p className={hintText}>
        {tw.theInvoiceIsNot}
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{tw.whatToCredit}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            checked={kind === "full"}
            onChange={() => setKind("full")}
            className="mt-0.5 size-4"
          />
          <span>
            {tw.allThatIsLeft} <span className="tabular-nums">{money(fullTotal)}</span> {tw.withVat}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="kind"
            checked={kind === "partial"}
            onChange={() => setKind("partial")}
            className="mt-0.5 size-4"
          />
          <span>{tw.someLinesOrPart}</span>
        </label>
      </fieldset>

      {kind === "partial" && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{tw.linesToCredit}</caption>
            <thead>
              <tr className="text-left text-xs tracking-wide text-muted uppercase">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {tw.line}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {tw.leftToCredit}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {tw.quantityToCredit}
                </th>
              </tr>
            </thead>
            <tbody>
              {creditable.map(({ line, left: remaining }) => {
                const value = choices.find((c) => c.lineId === line.id)?.quantity ?? "";
                const message =
                  attempted && partialProblem && !partialProblem.ok ? partialProblem.errors[line.id] : undefined;
                return (
                  <tr key={line.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3">{line.description}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {quantityField(remaining.quantityHundredths)} {line.unit === "hour" ? tw.hoursShort : tw.units}
                      <span className="block text-xs text-muted">{money(remaining.inclMinor)}</span>
                    </td>
                    <td className="py-2">
                      <label className="sr-only" htmlFor={`credit-${line.id}`}>
                        {fillWords(tw.creditOnLine, { line: line.description })}
                      </label>
                      <input
                        id={`credit-${line.id}`}
                        value={value}
                        onChange={(event) => setQuantity(line.id, event.target.value)}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        aria-invalid={message ? true : undefined}
                        aria-describedby={message ? `credit-${line.id}-error` : undefined}
                        className={`${control} max-w-32 text-right tabular-nums`}
                      />
                      {message && (
                        <p
                          id={`credit-${line.id}-error`}
                          role="alert"
                          className="mt-1 text-sm text-danger-text"
                        >
                          {message}
                        </p>
                      )}
                      {value.trim() !== "" && (
                        <button
                          type="button"
                          className="mt-1 block text-xs underline"
                          onClick={() => setQuantity(line.id, quantityField(remaining.quantityHundredths))}
                        >
                          {tw.allThatIsLeft2}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {attempted && partialProblem && !partialProblem.ok && partialProblem.general && (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {partialProblem.general}
            </p>
          )}
        </div>
      )}

      <Field
        label={tw.reason}
        error={attempted ? (reasonProblem ?? undefined) : undefined}
        hint={tw.printedOnTheCredit}
      >
        {(props) => (
          <textarea
            {...props}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            className={`${control} py-2`}
          />
        )}
      </Field>

      <Field
        label={tw.creditNoteDate}
        error={attempted ? (dateProblem ?? undefined) : undefined}
        hint={fillWords(tw.todayIsNotBefore, { day: formatDay(today, locale) })}
      >
        {(props) => (
          <input
            {...props}
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
          className="flex flex-col gap-2 rounded-md border border-warning-line bg-warning-soft p-3 text-sm text-warning-text"
        >
          <p>{earlierNeeded}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmEarlier}
              onChange={(event) => setConfirmEarlier(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>{tw.issueTheCreditNote}</span>
          </label>
        </div>
      )}

      {canRefund > 0 && (
        <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">{tw.moneyAlreadyReceived}</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={refund}
              onChange={(event) => setRefund(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              {fillWords(tw.iHavePaidBack, { amount: money(canRefund) })}
              <span className={`block ${hintText}`}>
                {tw.noMoneyMoved}
              </span>
            </span>
          </label>
          {refund && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={tw.paidBackBy}>
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
              <Field label={tw.referenceOptional}>
                {(props) => (
                  <input
                    {...props}
                    value={refundRef}
                    onChange={(event) => setRefundRef(event.target.value)}
                    maxLength={200}
                    autoComplete="off"
                    className={control}
                  />
                )}
              </Field>
            </div>
          )}
        </fieldset>
      )}

      <p className="text-sm" aria-live="polite">
        {tw.theCreditNoteIs} <strong className="tabular-nums">{money(total)}</strong> {tw.withVat2}
      </p>
      <Problems messages={problems} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onDone} className={secondaryButton}>
          {tw.cancel}
        </button>
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? tw.issuing : tw.issueCreditNote}
        </button>
      </div>
    </form>
  );
}
