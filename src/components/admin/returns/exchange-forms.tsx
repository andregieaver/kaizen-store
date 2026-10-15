"use client";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CASH_WARNING } from "@/components/admin/drafts/draft-send";
import { MANUAL_METHOD_LABELS, MANUAL_PAYMENT_METHODS } from "@/lib/draft-input";
import { EXCHANGE_AGREEMENT_NOTE_MAX } from "@/lib/exchange-limits";
import { CHANNEL_LABELS } from "@/lib/return-admin";
import { STAFF_EXCHANGE_CHANNELS } from "@/lib/exchange-status";

import type { StepAction } from "./step-forms";

/**
 * The small forms of an exchange that is out with the customer (wave 3, D239, `docs/wave-3-exchanges.md` 2.2): each is an `ActionForm` bound by the page to a server action
 * (`returns/[returnId]/exchange-actions.ts`, which asks `orders:write` and the server's own checks again). They take their actions as props, so a test can draw them.
 */

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";

/** *Send again* and *Create a new link*: either replaces the link the customer has. */
export function ResendExchangeForm({ action, toPay, shareable = true }: { action: StepAction; toPay: boolean; /** False for a withdrawal's proposal: email only (the customer's own press). */ shareable?: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        {toPay ? "The customer is emailed the link to pay again." : "The customer is emailed the proposal again."} The link they had stops working; at most five a day.
      </p>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary" name="createLink" value="0">
          Send again
        </SubmitButton>
        {shareable && (
          <SubmitButton variant="secondary" name="createLink" value="1">
            Create a new link to share
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

/** A form with one button and a sentence above it: withdraw, process, cancel. */
export function ExchangeButtonForm({ action, button, sentence, primary = false }: { action: StepAction; button: string; sentence?: string; primary?: boolean }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-2">
      {sentence && <p className="text-sm text-muted">{sentence}</p>}
      <div>
        <SubmitButton variant={primary ? "primary" : "secondary"}>{button}</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** *Record the customer's agreement* (voluntary returns only): how it came, the day, and a note kept in the history only. */
export function AgreementForm({ action, today }: { action: StepAction; today: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage="Recorded.">
      <p className="text-sm text-muted">
        For a return request inside your own window only. A withdrawal&apos;s refund goes another way only on the customer&apos;s own confirmation on the exchange page.
      </p>
      <label className={label}>
        How did they agree?
        <select name="channel" required defaultValue="email" className={input}>
          {STAFF_EXCHANGE_CHANNELS.map((channel) => (
            <option key={channel} value={channel}>
              {CHANNEL_LABELS[channel].replace(/^\w/, (c) => c.toUpperCase())}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        On <span className={hint}>(the store&apos;s day)</span>
        <input type="date" name="day" required max={today} defaultValue={today} className={`${input} sm:w-44`} />
      </label>
      <label className={label}>
        Note <span className={hint}>(optional, kept in the order&apos;s history; for staff)</span>
        <textarea name="note" rows={2} maxLength={EXCHANGE_AGREEMENT_NOTE_MAX} className={`${input} py-2`} />
      </label>
      <div>
        <SubmitButton variant="secondary">Record the agreement</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** *Record as paid outside Kaizen*: the difference the customer paid by bank transfer, in cash or another way. */
export function ExchangePaidOutsideForm({ action, today, amount }: { action: StepAction; today: string; amount: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage="Recorded.">
      <p className="text-sm text-muted">
        The customer paid you {amount} another way. The exchange is settled at once: the new order is marked paid and its invoice says the difference was paid outside the online checkout.
      </p>
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 font-medium">How was it paid?</legend>
        {MANUAL_PAYMENT_METHODS.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name="method" value={m} required defaultChecked={m === "bank_transfer"} className="size-4" />
            {MANUAL_METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted">{CASH_WARNING}</p>
      <label className={label}>
        Received on <span className={hint}>(leave empty if it was today)</span>
        <input type="date" name="receivedOn" max={today} className={`${input} sm:w-44`} />
      </label>
      <label className={label}>
        Reference <span className={hint}>(optional)</span>
        <input name="reference" maxLength={100} autoComplete="off" className={input} />
      </label>
      <div>
        <SubmitButton variant="secondary">Record as paid outside Kaizen</SubmitButton>
      </div>
    </ActionForm>
  );
}
