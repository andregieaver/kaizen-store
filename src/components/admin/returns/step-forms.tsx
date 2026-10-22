"use client";

import { useState, useTransition, type ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import type { RefundPreviewData } from "@/lib/return-admin";
import { RETURN_CONDITIONS } from "@/lib/return-input";
import type { ReturnAddress } from "@/lib/withdrawal";
import { formatMoney } from "@/lib/money";
import { formatPriceInput } from "@/lib/product-input";

/**
 * The forms of a return's steps (D153). Each is an `ActionForm` bound to a server action (`returns/actions.ts`, which asks
 * `requirePermission()` and the server's own checks again): the page binds the store and the return, these only draw the fields.
 * They take their actions as props, so a test can draw them without a server.
 */

export type StepAction = (state: FormState, form: FormData) => Promise<FormState>;

export type PreviewAction = (shipping: string) => Promise<{ ok: true; preview: RefundPreviewData } | { ok: false; problem: string }>;

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";

function Form({ action, children, successMessage }: { action: StepAction; children: ReactNode; successMessage: string }) {
  return (
    <ActionForm action={action} successMessage={successMessage} className="flex flex-col gap-3">
      {children}
    </ActionForm>
  );
}

// ---------------------------------------------------------------------------
// Instructions, address and label
// ---------------------------------------------------------------------------

export type InstructionsDefaults = { instructions: string; labelUrl: string; address: ReturnAddress | null };

function AddressFields({ address }: { address: ReturnAddress | null }) {
  const f = useAdminText("returns").forms;
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">
        {f.address} <span className={hint}>{f.addressHint}</span>
      </legend>
      <label className={label}>
        {f.name}
        <input name="addressName" defaultValue={address?.name ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        {f.street}
        <input name="addressStreet" defaultValue={address?.street ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        {f.postalCode}
        <input name="addressPostalCode" defaultValue={address?.postalCode ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        {f.city}
        <input name="addressCity" defaultValue={address?.city ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        {f.country} <span className={hint}>{f.countryHint}</span>
        <input name="addressCountry" defaultValue={address?.country ?? ""} maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-24`} />
      </label>
    </fieldset>
  );
}

function InstructionFields({ defaults }: { defaults: InstructionsDefaults }) {
  const f = useAdminText("returns").forms;
  return (
    <>
      <label className={label}>
        {f.instructions} <span className={hint}>{f.instructionsHint}</span>
        <textarea name="instructions" defaultValue={defaults.instructions} rows={4} maxLength={2000} className={`${input} py-2`} />
      </label>
      <AddressFields address={defaults.address} />
      <label className={label}>
        {f.label} <span className={hint}>{f.labelHint}</span>
        <input name="labelUrl" type="url" defaultValue={defaults.labelUrl} placeholder="https://…" className={input} />
      </label>
    </>
  );
}

/** Approves a return request: the customer is emailed how to send the goods back. */
export function ApproveForm({ action, defaults }: { action: StepAction; defaults: InstructionsDefaults }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.approved}>
      <InstructionFields defaults={defaults} />
      <div>
        <SubmitButton>{f.approve}</SubmitButton>
      </div>
    </Form>
  );
}

/** Changes the instructions, address and label of a return until the goods arrive. */
export function InstructionsForm({ action, defaults }: { action: StepAction; defaults: InstructionsDefaults }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.instructionsSaved}>
      <InstructionFields defaults={defaults} />
      <div>
        <SubmitButton variant="secondary">{f.saveInstructions}</SubmitButton>
      </div>
    </Form>
  );
}

/** Declines a return request with the reason the customer is emailed. */
export function DeclineForm({ action }: { action: StepAction }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.declined}>
      <label className={label}>
        {f.whyDeclined} <span className={hint}>{f.whyDeclinedHint}</span>
        <textarea name="reason" required rows={3} maxLength={1000} className={`${input} py-2`} />
      </label>
      <div>
        <SubmitButton variant="secondary">{f.decline}</SubmitButton>
      </div>
    </Form>
  );
}

/** Declines one line of a return: a line the law excludes from the right of withdrawal, or any line of a return request. */
export function DeclineLineForm({ action, lineId }: { action: StepAction; lineId: string }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.lineDeclined}>
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${label} min-w-48 flex-1`}>
          <span className="sr-only">{f.whyLine}</span>
          <input name="reason" required maxLength={500} placeholder={f.whyLine} className={input} />
        </label>
        <SubmitButton variant="secondary">{f.declineLine}</SubmitButton>
      </div>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// The goods
// ---------------------------------------------------------------------------

/** The day the goods were sent or arrived: today unless another day is chosen (never in the future: the server holds it to now). */
export function DayStepForm({ action, button, help, today, successMessage }: { action: StepAction; button: string; help: string; today: string; successMessage: string }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={successMessage}>
      <label className={label}>
        {f.day} <span className={hint}>({help})</span>
        <input name="on" type="date" max={today} className={`${input} sm:w-48`} />
      </label>
      <div>
        <SubmitButton>{button}</SubmitButton>
      </div>
    </Form>
  );
}

export type InspectLine = {
  lineId: string;
  title: string;
  sku: string;
  quantity: number;
  condition: string | null;
  restock: boolean;
  deduction: string;
  deductionNote: string;
  /** Digital goods, services and bookings never go back into stock. */
  physical: boolean;
  /** What the units are worth to the refund: the most a deduction can be, as a typed amount. */
  valueLabel: string;
};

/** Inspects the goods line by line: condition, whether they go back into stock, and a deduction for diminished value. */
export function InspectForm({ action, lines, currency, changing }: { action: StepAction; lines: InspectLine[]; currency: string; changing: boolean }) {
  const f = useAdminText("returns").forms;
  const conditions = useAdminText("returns").labels.condition;
  return (
    <Form action={action} successMessage={changing ? f.inspectChanged : f.inspected}>
      <p className="text-sm text-muted">{f.deductionRule}</p>
      <ul className="flex flex-col gap-4">
        {lines.map((line) => (
          <li key={line.lineId} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <p className="text-sm font-medium">
              {line.title} <span className="font-normal text-muted">× {line.quantity} · {line.sku}</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <label className={label}>
                {f.condition}
                <select name={`condition:${line.lineId}`} required defaultValue={line.condition ?? ""} className={input}>
                  <option value="" disabled>
                    {f.choose}
                  </option>
                  {RETURN_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {conditions[condition]}
                    </option>
                  ))}
                </select>
              </label>
              {line.physical ? (
                <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                  <input type="checkbox" name={`restock:${line.lineId}`} defaultChecked={line.restock} className="size-4" />
                  {f.putBack}
                </label>
              ) : (
                <p className="self-end text-sm text-muted">{f.notPhysical}</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <label className={label}>
                {fillWords(f.deduction, { currency })} <span className={hint}>{fillWords(f.atMost, { value: line.valueLabel })}</span>
                <input name={`deduction:${line.lineId}`} inputMode="decimal" defaultValue={line.deduction} placeholder="0" className={input} />
              </label>
              <label className={label}>
                {f.deductionFor}
                <input name={`deductionNote:${line.lineId}`} defaultValue={line.deductionNote} maxLength={500} className={input} />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <SubmitButton>{f.saveInspection}</SubmitButton>
      </div>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// The refund
// ---------------------------------------------------------------------------

export type RefundLine = { lineId: string; title: string; quantity: number; restock: number };

const typed = formatPriceInput;

/** The refund's working: each row of it, and what it comes to. */
export function RefundWorking({ preview, currency, locale }: { preview: RefundPreviewData; currency: string; locale: string }) {
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const w = useAdminText("returns");
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{w.forms.workingCaption}</caption>
        <tbody>
          {preview.working.map((row) => (
            <tr key={row.key} className="border-b border-line">
              <th scope="row" className="py-1.5 pr-3 font-normal">
                {w.labels.working[row.key]}
              </th>
              <td className="py-1.5 text-right tabular-nums">{row.amountMinor < 0 ? `−${money(-row.amountMinor)}` : money(row.amountMinor)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-2 pr-3 font-medium">
              {w.forms.toRefund}
            </th>
            <td className="pt-2 text-right font-medium tabular-nums">{money(preview.amountMinor)}</td>
          </tr>
        </tbody>
      </table>
      {preview.cappedBy && <p className="text-sm text-warning-text">{w.labels.capped[preview.cappedBy]}</p>}
    </div>
  );
}

/**
 * The refund, with its working before the button. The sum is worked out by the same function the server uses
 * (`refundFor()`): the screen only asks for it again when the return shipping changes, and the server works it out once
 * more before anything is refunded. Staff may change the amount with a reason; the change is logged.
 */
export function RefundPanel({
  action,
  preview: initial,
  recalculate,
  currency,
  locale,
  lines,
  whoPays,
  kind = "return",
  bookedLabel = null,
}: {
  action: StepAction;
  preview: RefundPreviewData;
  recalculate: PreviewAction;
  currency: string;
  locale: string;
  lines: RefundLine[];
  /** Who pays for sending the goods back, as the store's setting stood when the order was placed. */
  whoPays: "shopper" | "store";
  /** A withdrawal is refunded in full: its amount can be raised, not lowered. */
  kind?: "withdrawal" | "return";
  /**
   * A label booked with the carrier (D239 4.8, As built): nothing was taken off when it was booked, so the field starts at 0 and staff take the cost off only
   * when the parcel came back with this label; a test label is never taken off.
   */
  bookedLabel?: { source: "pasted" | "carrier" | null; costMinor: number | null; test: boolean } | null;
}) {
  const f = useAdminText("returns").forms;
  const [preview, setPreview] = useState(initial);
  const [shipping, setShipping] = useState(initial.returnShippingMinor > 0 ? typed(initial.returnShippingMinor, currency) : "");
  const [amount, setAmount] = useState(typed(initial.amountMinor, currency));
  const [problem, setProblem] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const computed = typed(preview.amountMinor, currency);
  const changed = amount.trim() !== computed;

  const again = (value: string = shipping) =>
    startTransition(async () => {
      setProblem(null);
      const result = await recalculate(value);
      if (!result.ok) return setProblem(result.problem);
      setPreview(result.preview);
      setAmount(typed(result.preview.amountMinor, currency));
    });

  return (
    <div className="flex flex-col gap-4">
      <RefundWorking preview={preview} currency={currency} locale={locale} />
      {!preview.canRefund && (
        <p role="note" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text">
          {f.notThroughStripe}
        </p>
      )}
      <ActionForm action={action} successMessage={preview.canRefund ? f.refunded : f.refundedOutside} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {whoPays === "shopper" ? (
            <label className={label}>
              {fillWords(f.returnShipping, { currency })} <span className={hint}>{f.ifLabel}</span>
              <input name="shipping" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" className={`${input} sm:w-56`} />
            </label>
          ) : (
            <p className="text-sm text-muted">{f.storePaysShipping}</p>
          )}
          {whoPays === "shopper" && (
            <button type="button" onClick={() => again()} disabled={working} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40">
              {working ? f.working : f.workAgain}
            </button>
          )}
        </div>
        {whoPays === "shopper" && bookedLabel?.source === "carrier" && (
          <div className="flex flex-col gap-2 text-sm" data-label-deduction>
            {bookedLabel.test ? (
              <p className="text-muted">{f.testLabel}</p>
            ) : bookedLabel.costMinor !== null && bookedLabel.costMinor > 0 ? (
              <>
                <p className="text-muted">{fillWords(f.labelCost, { amount: formatMoney(bookedLabel.costMinor, currency, locale) })}</p>
                <div>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      const value = typed(bookedLabel.costMinor!, currency);
                      setShipping(value);
                      again(value);
                    }}
                    className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40"
                  >
                    {fillWords(f.takeOff, { amount: formatMoney(bookedLabel.costMinor, currency, locale) })}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-muted">{f.labelNotPriced}</p>
            )}
          </div>
        )}
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            {fillWords(f.amount, { currency })}
            <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className={`${input} sm:w-48`} />
          </label>
          <p className="pb-2 text-sm text-muted">{fillWords(f.leftAtMost, { amount: formatMoney(preview.refundableMinor, currency, locale) })}</p>
        </div>
        {kind === "withdrawal" && (
          <p className="text-sm text-muted">{f.withdrawalFull}</p>
        )}
        <label className={label}>
          {changed ? f.whyDifferent : f.aNote}
          <input name="reason" maxLength={500} required={changed} placeholder={changed ? f.reasonKept : ""} className={input} />
        </label>
        {lines.some((l) => l.quantity > 0) && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{f.putBack}</legend>
            {lines.map((line) => (
              <label key={line.lineId} className="flex flex-wrap items-center gap-2 text-sm">
                <input name={`restock:${line.lineId}`} type="number" min={0} max={line.quantity} defaultValue={line.restock} className="min-h-10 w-20 rounded-md border border-line bg-card px-3" />
                <span>{fillWords(f.ofLine, { n: line.quantity, title: line.title })}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div>
          <SubmitButton>{preview.canRefund ? fillWords(f.refundAmount, { amount: formatMoney(preview.amountMinor, currency, locale) }) : f.recordOutside}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ending, notes and the acknowledgement
// ---------------------------------------------------------------------------

export function CloseForm({ action, needsConfirm }: { action: StepAction; needsConfirm: boolean }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.closed}>
      {needsConfirm && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmNoRefund" required className="mt-0.5 size-4" />
          <span>{f.closeNoRefund}</span>
        </label>
      )}
      <label className={label}>
        {f.noteOptional} <span className={hint}>{f.noteOptionalHint}</span>
        <input name="note" maxLength={1000} className={input} />
      </label>
      <div>
        <SubmitButton variant="secondary">{f.closeReturn}</SubmitButton>
      </div>
    </Form>
  );
}

export function CancelForm({ action }: { action: StepAction }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.cancelled}>
      <label className={label}>
        {f.noteOptional} <span className={hint}>{f.noteOptionalHint}</span>
        <input name="note" maxLength={1000} className={input} />
      </label>
      <div>
        <SubmitButton variant="secondary">{f.cancelReturn}</SubmitButton>
      </div>
    </Form>
  );
}

/** The store's own note on a return: never shown to the customer, and kept after the return has ended. */
export function NoteForm({ action, note }: { action: StepAction; note: string }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.saved}>
      <label className={label}>
        {f.note} <span className={hint}>{f.noteHint}</span>
        <textarea name="note" defaultValue={note} rows={3} maxLength={2000} className={`${input} py-2`} />
      </label>
      <div>
        <SubmitButton variant="secondary">{f.saveNote}</SubmitButton>
      </div>
    </Form>
  );
}

/** Sends the acknowledgement of a confirmed withdrawal again, to the address the customer gave. */
export function AcknowledgementForm({ action }: { action: StepAction }) {
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.ackSent}>
      <div>
        <SubmitButton>{f.sendAck}</SubmitButton>
      </div>
    </Form>
  );
}

export type RegisterLine = { lineId: string; title: string; quantity: number; remaining: number; maxQuantity: number; refused: string | null };

const CHANNEL_CHOICES = ["email", "letter", "phone", "in_person", "other"] as const;

/**
 * Registers a withdrawal the customer made outside the withdrawal function (an email, a letter, a call, or a statement the
 * function could not match to the order): the law counts any clear statement (CRD Art. 11), so the store records it as the
 * customer's own two steps would have. The day the store was told starts the 14 days for the refund and is what the
 * acknowledgement states. A line whose 14 days had passed by the records can be accepted as in time, with the reason.
 */
export function RegisterWithdrawalForm({ action, lines, today }: { action: StepAction; lines: RegisterLine[]; today: string }) {
  const choosable = lines.filter((line) => line.remaining > 0);
  const f = useAdminText("returns").forms;
  return (
    <Form action={action} successMessage={f.registered}>
      <label className={label}>
        {f.customerName}
        <input name="name" required maxLength={120} autoComplete="off" className={`${input} sm:w-72`} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          {f.howTold}
          <select name="channel" defaultValue="email" className={`${input} sm:w-56`}>
            {CHANNEL_CHOICES.map((value) => (
              <option key={value} value={value}>
                {f.channelChoices[value]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {f.dayTold} <span className={hint}>{f.todayIfEmpty}</span>
          <input name="informedOn" type="date" max={today} className={`${input} sm:w-48`} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{f.withdrawFrom}</legend>
        {choosable.length === 0 && <p className="text-sm text-muted">{f.allTaken}</p>}
        {choosable.map((line) => (
          <div key={line.lineId} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" name={`take:${line.lineId}`} defaultChecked={line.maxQuantity > 0} aria-label={fillWords(f.withdrawLine, { title: line.title })} className="size-4" />
            <input
              name={`qty:${line.lineId}`}
              type="number"
              min={1}
              max={line.remaining}
              defaultValue={Math.max(1, line.maxQuantity || line.remaining)}
              aria-label={fillWords(f.numberOf, { title: line.title })}
              className="min-h-10 w-20 rounded-md border border-line bg-card px-3"
            />
            <span>{fillWords(f.ofRemaining, { n: line.remaining, title: line.title })}</span>
            {line.refused && <span className="text-muted">({line.refused})</span>}
          </div>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="late" className="size-4" />
        {f.late}
      </label>
      <label className={label}>
        {f.whyLonger} <span className={hint}>{f.whyLongerHint}</span>
        <input name="lateReason" maxLength={500} className={input} />
      </label>
      <label className={label}>
        {f.noteOptional} <span className={hint}>{f.noteKept}</span>
        <input name="note" maxLength={500} className={input} />
      </label>
      <div>
        <SubmitButton>{f.register}</SubmitButton>
      </div>
    </Form>
  );
}
