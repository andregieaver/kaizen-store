"use client";

import { useState, useTransition, type FormEvent } from "react";

import { markLostAction, reverseLossAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { Modal } from "@/components/admin/modal";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { formatMoney } from "@/lib/money";
import { minorToDecimal, parseMoneyText } from "@/lib/work-calc";
import { isDay } from "@/lib/work-dates";

import { Field, Problems, control, hintText, primaryButton, secondaryButton, smallButton } from "./work-parts";

/**
 * Writing off a lost invoice (D500), owners only: what is outstanding unless less is given, on a day, with why. Only for a loss that is
 * established (the client bankrupt, collection failed): the books take the VAT on it back. Taking a loss back adds a reversing row.
 */
export function MarkLostButton({
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
  const tw = useAdminText("work").invoiceLosses;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(minorToDecimal(outstandingMinor, currency));
  const [day, setDay] = useState(today);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minor = amount.trim() === "" ? null : parseMoneyText(amount, currency);
    if (minor === null || minor <= 0) return setProblems([tw.amountProblem]);
    if (minor > outstandingMinor) return setProblems([tw.tooMuch]);
    if (!isDay(day)) return setProblems([tw.dayProblem]);
    setProblems([]);
    start(async () => {
      try {
        const result = await markLostAction(storeSlug, { invoiceId, amountMinor: minor, writtenOffOn: day, reason: reason.trim() || undefined });
        if (result.ok) setOpen(false);
        else setProblems(result.problems);
      } catch {
        setProblems([tw.failed]);
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButton}>
        {tw.markLost}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tw.markLost}>
        <form onSubmit={submit} aria-busy={pending} className="flex flex-col gap-4">
          <p className="text-sm">{tw.text}</p>
          <p className={hintText}>{fillWords(tw.outstanding, { amount: formatMoney(outstandingMinor, currency, locale) })}</p>
          <div className="flex flex-wrap gap-3">
            <Field label={tw.amount} className="w-44">
              {(props) => <input {...props} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={control} />}
            </Field>
            <Field label={tw.day} className="w-44">
              {(props) => <input {...props} type="date" value={day} max={today} onChange={(event) => setDay(event.target.value)} className={control} />}
            </Field>
          </div>
          <Field label={tw.reason}>
            {(props) => <input {...props} value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className={control} />}
          </Field>
          <Problems messages={problems} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              {tw.cancel}
            </button>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? tw.saving : tw.confirm}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function TakeBackLossButton({ storeSlug, lossId, label }: { storeSlug: string; lossId: string; label: string }) {
  const tw = useAdminText("work").invoiceLosses;
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setProblems([]);
    start(async () => {
      try {
        const result = await reverseLossAction(storeSlug, { lossId });
        if (result.ok) setOpen(false);
        else setProblems(result.problems);
      } catch {
        setProblems([tw.failed]);
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={fillWords(tw.takeBackLabel, { loss: label })} className={smallButton}>
        {tw.takeBack}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={tw.takeBack}>
        <form onSubmit={submit} aria-busy={pending} className="flex flex-col gap-4">
          <p className="text-sm">{fillWords(tw.takeBackText, { loss: label })}</p>
          <Problems messages={problems} />
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              {tw.cancel}
            </button>
            <button type="submit" disabled={pending} className={primaryButton}>
              {pending ? tw.saving : tw.takeBack}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
