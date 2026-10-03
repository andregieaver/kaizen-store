"use client";

import { useState, useTransition, type ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { CAPPED_WORDS, CONDITION_LABELS, WORKING_LABELS, type RefundPreviewData } from "@/lib/return-admin";
import { RETURN_CONDITIONS } from "@/lib/return-input";
import type { ReturnAddress } from "@/lib/withdrawal";
import { formatMoney } from "@/lib/money";
import { formatPriceInput } from "@/lib/product-input";

/**
 * The forms of a return's steps (D153). Each is an `ActionForm` bound to a server action (`returns/actions.ts`, which asks
 * `requireMember()` and the server's own checks again): the page binds the store and the return, these only draw the fields.
 * They take their actions as props, so a test can draw them without a server.
 */

export type StepAction = (state: FormState, form: FormData) => Promise<FormState>;

export type PreviewAction = (shipping: string) => Promise<{ ok: true; preview: RefundPreviewData } | { ok: false; problem: string }>;

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
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
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-medium">
        Return address <span className={hint}>(fill in all of it, or leave it empty)</span>
      </legend>
      <label className={label}>
        Name
        <input name="addressName" defaultValue={address?.name ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        Street
        <input name="addressStreet" defaultValue={address?.street ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        Postal code
        <input name="addressPostalCode" defaultValue={address?.postalCode ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        City
        <input name="addressCity" defaultValue={address?.city ?? ""} autoComplete="off" className={input} />
      </label>
      <label className={label}>
        Country <span className={hint}>(two letters, such as NO)</span>
        <input name="addressCountry" defaultValue={address?.country ?? ""} maxLength={2} autoComplete="off" className={`${input} uppercase sm:w-24`} />
      </label>
    </fieldset>
  );
}

function InstructionFields({ defaults }: { defaults: InstructionsDefaults }) {
  return (
    <>
      <label className={label}>
        Instructions for the customer <span className={hint}>(how to pack and send the goods back)</span>
        <textarea name="instructions" defaultValue={defaults.instructions} rows={4} maxLength={2000} className={`${input} py-2`} />
      </label>
      <AddressFields address={defaults.address} />
      <label className={label}>
        Return label <span className={hint}>(optional: a link starting with https://)</span>
        <input name="labelUrl" type="url" defaultValue={defaults.labelUrl} placeholder="https://…" className={input} />
      </label>
    </>
  );
}

/** Approves a return request: the customer is emailed how to send the goods back. */
export function ApproveForm({ action, defaults }: { action: StepAction; defaults: InstructionsDefaults }) {
  return (
    <Form action={action} successMessage="Approved. The customer has been told how to send the goods back.">
      <InstructionFields defaults={defaults} />
      <div>
        <SubmitButton>Approve the return</SubmitButton>
      </div>
    </Form>
  );
}

/** Changes the instructions, address and label of a return until the goods arrive. */
export function InstructionsForm({ action, defaults }: { action: StepAction; defaults: InstructionsDefaults }) {
  return (
    <Form action={action} successMessage="Saved. Customers who are told again will read the new instructions.">
      <InstructionFields defaults={defaults} />
      <div>
        <SubmitButton variant="secondary">Save instructions</SubmitButton>
      </div>
    </Form>
  );
}

/** Declines a return request with the reason the customer is emailed. */
export function DeclineForm({ action }: { action: StepAction }) {
  return (
    <Form action={action} successMessage="Declined. The customer has been told why.">
      <label className={label}>
        Why is it declined? <span className={hint}>(the customer is emailed this)</span>
        <textarea name="reason" required rows={3} maxLength={1000} className={`${input} py-2`} />
      </label>
      <div>
        <SubmitButton variant="secondary">Decline the return</SubmitButton>
      </div>
    </Form>
  );
}

/** Declines one line of a return: a line the law excludes from the right of withdrawal, or any line of a return request. */
export function DeclineLineForm({ action, lineId }: { action: StepAction; lineId: string }) {
  return (
    <Form action={action} successMessage="The line is declined.">
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${label} min-w-48 flex-1`}>
          <span className="sr-only">Why this line is declined</span>
          <input name="reason" required maxLength={500} placeholder="Why this line is declined" className={input} />
        </label>
        <SubmitButton variant="secondary">Decline this line</SubmitButton>
      </div>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// The goods
// ---------------------------------------------------------------------------

/** The day the goods were sent or arrived: today unless another day is chosen (never in the future: the server holds it to now). */
export function DayStepForm({ action, button, help, today, successMessage }: { action: StepAction; button: string; help: string; today: string; successMessage: string }) {
  return (
    <Form action={action} successMessage={successMessage}>
      <label className={label}>
        Day <span className={hint}>({help})</span>
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
  return (
    <Form action={action} successMessage={changing ? "The inspection is changed." : "Inspected."}>
      <p className="text-sm text-muted">
        A deduction for diminished value is only for handling beyond what was needed to establish what the goods are and that they work, as in a
        shop (Consumer Rights Directive Art. 14(2)). It is never more than the goods are worth, and the customer is told what it is for.
      </p>
      <ul className="flex flex-col gap-4">
        {lines.map((line) => (
          <li key={line.lineId} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {line.title} <span className="font-normal text-muted">× {line.quantity} · {line.sku}</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <label className={label}>
                Condition
                <select name={`condition:${line.lineId}`} required defaultValue={line.condition ?? ""} className={input}>
                  <option value="" disabled>
                    Choose …
                  </option>
                  {RETURN_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {CONDITION_LABELS[condition]}
                    </option>
                  ))}
                </select>
              </label>
              {line.physical ? (
                <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                  <input type="checkbox" name={`restock:${line.lineId}`} defaultChecked={line.restock} className="size-4" />
                  Put back in stock
                </label>
              ) : (
                <p className="self-end text-sm text-muted">Not put back in stock: it is not a physical product.</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <label className={label}>
                Deduction ({currency}) <span className={hint}>at most {line.valueLabel}</span>
                <input name={`deduction:${line.lineId}`} inputMode="decimal" defaultValue={line.deduction} placeholder="0" className={input} />
              </label>
              <label className={label}>
                What the deduction is for
                <input name={`deductionNote:${line.lineId}`} defaultValue={line.deductionNote} maxLength={500} className={input} />
              </label>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <SubmitButton>Save the inspection</SubmitButton>
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
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">How the refund is worked out</caption>
        <tbody>
          {preview.working.map((row) => (
            <tr key={row.key} className="border-b border-border">
              <th scope="row" className="py-1.5 pr-3 font-normal">
                {WORKING_LABELS[row.key]}
              </th>
              <td className="py-1.5 text-right tabular-nums">{row.amountMinor < 0 ? `−${money(-row.amountMinor)}` : money(row.amountMinor)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="pt-2 pr-3 font-semibold">
              To refund
            </th>
            <td className="pt-2 text-right font-semibold tabular-nums">{money(preview.amountMinor)}</td>
          </tr>
        </tbody>
      </table>
      {preview.cappedBy && <p className="text-sm text-amber-800 dark:text-amber-300">{CAPPED_WORDS[preview.cappedBy]}</p>}
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
}) {
  const [preview, setPreview] = useState(initial);
  const [shipping, setShipping] = useState(initial.returnShippingMinor > 0 ? typed(initial.returnShippingMinor, currency) : "");
  const [amount, setAmount] = useState(typed(initial.amountMinor, currency));
  const [problem, setProblem] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const computed = typed(preview.amountMinor, currency);
  const changed = amount.trim() !== computed;

  const again = () =>
    startTransition(async () => {
      setProblem(null);
      const result = await recalculate(shipping);
      if (!result.ok) return setProblem(result.problem);
      setPreview(result.preview);
      setAmount(typed(result.preview.amountMinor, currency));
    });

  return (
    <div className="flex flex-col gap-4">
      <RefundWorking preview={preview} currency={currency} locale={locale} />
      {!preview.canRefund && (
        <p role="note" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This order was not paid through Kaizen&apos;s Stripe, or there is nothing left to refund through it. Refund the customer where they paid;
          pressing the button records the refund as made outside, and puts goods back in stock.
        </p>
      )}
      <ActionForm action={action} successMessage={preview.canRefund ? "Refunded." : "Recorded as refunded outside Kaizen's Stripe."} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          {whoPays === "shopper" ? (
            <label className={label}>
              Return shipping the customer pays ({currency}) <span className={hint}>if you paid for a label</span>
              <input name="shipping" inputMode="decimal" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="0" className={`${input} sm:w-56`} />
            </label>
          ) : (
            <p className="text-sm text-muted">You pay for return shipping, so nothing is taken off for it.</p>
          )}
          {whoPays === "shopper" && (
            <button type="button" onClick={again} disabled={working} className="min-h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40">
              {working ? "Working …" : "Work it out again"}
            </button>
          )}
        </div>
        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            Amount to refund ({currency})
            <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required className={`${input} sm:w-48`} />
          </label>
          <p className="pb-2 text-sm text-muted">At most {formatMoney(preview.refundableMinor, currency, locale)} is left to refund.</p>
        </div>
        {kind === "withdrawal" && (
          <p className="text-sm text-muted">
            A withdrawal is refunded in full. What is taken off is the deduction you set when you inspected the goods (with its note) and the return
            shipping the customer pays; both are in the working. You can raise the amount here, with a reason, but not lower it.
          </p>
        )}
        <label className={label}>
          {changed ? "Why is it different from the working? (required)" : "A note, if you want one"}
          <input name="reason" maxLength={500} required={changed} placeholder={changed ? "The reason is kept with the refund" : ""} className={input} />
        </label>
        {lines.some((l) => l.quantity > 0) && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Put back in stock</legend>
            {lines.map((line) => (
              <label key={line.lineId} className="flex flex-wrap items-center gap-2 text-sm">
                <input name={`restock:${line.lineId}`} type="number" min={0} max={line.quantity} defaultValue={line.restock} className="min-h-10 w-20 rounded-md border border-border bg-background px-3" />
                <span>
                  of {line.quantity} × {line.title}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div>
          <SubmitButton>{preview.canRefund ? `Refund ${formatMoney(preview.amountMinor, currency, locale)}` : "Record as refunded outside"}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ending, notes and the acknowledgement
// ---------------------------------------------------------------------------

export function CloseForm({ action, needsConfirm }: { action: StepAction; needsConfirm: boolean }) {
  return (
    <Form action={action} successMessage="Closed.">
      {needsConfirm && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="confirmNoRefund" required className="mt-0.5 size-4" />
          <span>This withdrawal has not been refunded. I want to close it with no refund.</span>
        </label>
      )}
      <label className={label}>
        A note <span className={hint}>(optional, only the store sees it)</span>
        <input name="note" maxLength={1000} className={input} />
      </label>
      <div>
        <SubmitButton variant="secondary">Close the return</SubmitButton>
      </div>
    </Form>
  );
}

export function CancelForm({ action }: { action: StepAction }) {
  return (
    <Form action={action} successMessage="Cancelled.">
      <label className={label}>
        A note <span className={hint}>(optional, only the store sees it)</span>
        <input name="note" maxLength={1000} className={input} />
      </label>
      <div>
        <SubmitButton variant="secondary">Cancel the return</SubmitButton>
      </div>
    </Form>
  );
}

/** The store's own note on a return: never shown to the customer, and kept after the return has ended. */
export function NoteForm({ action, note }: { action: StepAction; note: string }) {
  return (
    <Form action={action} successMessage="Saved.">
      <label className={label}>
        Note <span className={hint}>(only the store sees it)</span>
        <textarea name="note" defaultValue={note} rows={3} maxLength={2000} className={`${input} py-2`} />
      </label>
      <div>
        <SubmitButton variant="secondary">Save the note</SubmitButton>
      </div>
    </Form>
  );
}

/** Sends the acknowledgement of a confirmed withdrawal again, to the address the customer gave. */
export function AcknowledgementForm({ action }: { action: StepAction }) {
  return (
    <Form action={action} successMessage="The acknowledgement was sent again.">
      <div>
        <SubmitButton>Send the acknowledgement again</SubmitButton>
      </div>
    </Form>
  );
}

export type RegisterLine = { lineId: string; title: string; quantity: number; remaining: number; maxQuantity: number; refused: string | null };

const CHANNEL_CHOICES: [string, string][] = [
  ["email", "An email"],
  ["letter", "A letter"],
  ["phone", "A phone call"],
  ["in_person", "In person"],
  ["other", "Some other way"],
];

/**
 * Registers a withdrawal the customer made outside the withdrawal function (an email, a letter, a call, or a statement the
 * function could not match to the order): the law counts any clear statement (CRD Art. 11), so the store records it as the
 * customer's own two steps would have. The day the store was told starts the 14 days for the refund and is what the
 * acknowledgement states. A line whose 14 days had passed by the records can be accepted as in time, with the reason.
 */
export function RegisterWithdrawalForm({ action, lines, today }: { action: StepAction; lines: RegisterLine[]; today: string }) {
  const choosable = lines.filter((line) => line.remaining > 0);
  return (
    <Form action={action} successMessage="Registered. The withdrawal is on record and the customer has been sent the acknowledgement.">
      <label className={label}>
        Customer&apos;s name
        <input name="name" required maxLength={120} autoComplete="off" className={`${input} sm:w-72`} />
      </label>
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          How did they tell you?
          <select name="channel" defaultValue="email" className={`${input} sm:w-56`}>
            {CHANNEL_CHOICES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Day you were told <span className={hint}>(today if left empty)</span>
          <input name="informedOn" type="date" max={today} className={`${input} sm:w-48`} />
        </label>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What they withdraw from</legend>
        {choosable.length === 0 && <p className="text-sm text-muted">Everything on this order is already part of a withdrawal or return.</p>}
        {choosable.map((line) => (
          <div key={line.lineId} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" name={`take:${line.lineId}`} defaultChecked={line.maxQuantity > 0} aria-label={`Withdraw from ${line.title}`} className="size-4" />
            <input
              name={`qty:${line.lineId}`}
              type="number"
              min={1}
              max={line.remaining}
              defaultValue={Math.max(1, line.maxQuantity || line.remaining)}
              aria-label={`Number of ${line.title}`}
              className="min-h-10 w-20 rounded-md border border-border bg-background px-3"
            />
            <span>
              of {line.remaining} × {line.title}
            </span>
            {line.refused && <span className="text-muted">({line.refused})</span>}
          </div>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="late" className="size-4" />
        Accept as in time although the 14 days had passed by the records
      </label>
      <label className={label}>
        Why is the period longer? <span className={hint}>(only with the box above: for example the customer was not given the information about the right of withdrawal)</span>
        <input name="lateReason" maxLength={500} className={input} />
      </label>
      <label className={label}>
        A note <span className={hint}>(kept on the return, never shown to the customer)</span>
        <input name="note" maxLength={500} className={input} />
      </label>
      <div>
        <SubmitButton>Register the withdrawal</SubmitButton>
      </div>
    </Form>
  );
}
