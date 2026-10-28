"use client";

import { MANUAL_PAYMENT_METHODS } from "@/lib/draft-input";
import { countWords, fillWords } from "@/lib/admin-fill";
import { useAdminText } from "@/components/admin/admin-text";
import { useActionState, useRef, useState, type ReactNode } from "react";

import { NotifySwitchedOff } from "@/components/admin/orders/notify-off";
import {
  addNoteAction,
  cancelOrderAction,
  markBalancePaidAction,
  recordTermsPaidAction,
  refundOrderAction,
  resendConfirmationAction,
  updateContactAction,
  type OrderActionState,
} from "@/app/admin/(gated)/[store]/orders/actions";

const initial: OrderActionState = { ok: false, message: null };
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50";
const secondary = "min-h-10 rounded-pill border border-edge px-4 text-sm disabled:opacity-50";

type Ids = { storeSlug: string; orderId: string };

function Result({ state }: { state: OrderActionState }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm empty:hidden ${state.ok ? "" : "text-danger-text "}`}
    >
      {state.message}
    </p>
  );
}

function Notify({ defaultChecked = true, children }: { defaultChecked?: boolean; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="notify" defaultChecked={defaultChecked} className="size-4" />
      {children}
    </label>
  );
}

/** Refunds any amount up to what is left, and puts chosen items back in stock. */
export function RefundForm({
  storeSlug,
  orderId,
  refundable,
  refundableLabel,
  lines,
  locations = [],
  hasEmail,
  canRefund,
  outside = null,
  unitsToSend = 0,
  notifyOff = null,
}: Ids & {
  /** The refund email is switched off in Notifications (D238): the box is drawn off, linking there. */
  notifyOff?: string | null;
  /**
   * The money was taken outside Kaizen (wave 3, D173): the refund is only RECORDED here, with no call to Stripe, and staff pay the customer back themselves. `allowed` is false when only the
   * owner may record it and this person is not the owner.
   */
  outside?: { allowed: boolean } | null;
  refundable: string;
  refundableLabel: string;
  /** `putBack` says where the units go when nobody chooses (wave 3, D172): back where they were taken from. */
  lines: { id: string; title: string; left: number; putBack?: string }[];
  /** The store's active stock locations in rank order; a choice is offered only with more than one. */
  locations?: { id: string; name: string }[];
  hasEmail: boolean;
  canRefund: boolean;
  /**
   * Units of the order still to send (D174). With any, the form offers *These units were not sent* (ticked): the units put back come off what is still to send, so
   * the order is not waiting to send what was refunded.
   */
  unitsToSend?: number;
}) {
  const [state, action, pending] = useActionState(refundOrderAction.bind(null, storeSlug, orderId), initial);
  const [amount, setAmount] = useState("");
  const w = useAdminText("order").forms;
  return (
    <form action={action} className="flex flex-col gap-3">
      {outside && (
        <p role="note" className="rounded-md border border-line bg-sunken p-3 text-sm">
          {outside.allowed
            ? w.paidOutsideNote
            : w.paidOutsideOwner}
        </p>
      )}
      {canRefund && !(outside && !outside.allowed) ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            {outside ? w.amountPaidBack : w.amountToRefund}
            <input
              name="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className={`${input} w-36`}
            />
          </label>
          <button type="button" onClick={() => setAmount(refundable)} className="min-h-10 text-sm underline">
            {fillWords(w.everythingLeft, { amount: refundableLabel })}
          </button>
        </div>
      ) : outside ? null : (
        <p className="text-sm text-muted">{w.refundInStripe}</p>
      )}
      {canRefund && !outside && (
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">{w.refundTo}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="refundTo" value="payment" defaultChecked className="size-4" />
            {w.refundToPayment}
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="refundTo" value="credit" className="mt-0.5 size-4" />
            <span>
              {w.refundToCredit}
              <span className="block text-xs text-muted">{w.refundToCreditHint}</span>
            </span>
          </label>
        </fieldset>
      )}
      <label className={label}>
        <span>
          {w.reason} <span className="font-normal text-muted">{w.forRecords}</span>
        </span>
        <input name="reason" maxLength={500} className={input} />
      </label>
      {lines.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{w.putBack}</legend>
          {lines.map((line) => (
            <div key={line.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <label htmlFor={`restock-${line.id}`}>{line.title}</label>
                <span className="flex items-center gap-2">
                  {locations.length > 1 && (
                    <select
                      name={`restockAt:${line.id}`}
                      defaultValue=""
                      aria-label={fillWords(w.putBackAt, { title: line.title })}
                      className="min-h-10 rounded-md border border-line bg-card px-2 text-sm"
                    >
                      <option value="">{w.whereTaken}</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    id={`restock-${line.id}`}
                    type="number"
                    name={`restock:${line.id}`}
                    min={0}
                    max={line.left}
                    defaultValue={0}
                    aria-label={fillWords(w.unitsToPutBack, { title: line.title })}
                    className="min-h-10 w-20 shrink-0 rounded-md border border-line bg-card px-3 text-sm"
                  />
                </span>
              </div>
              {line.putBack && <p className="text-xs text-muted">{line.putBack}</p>}
            </div>
          ))}
          {unitsToSend > 0 && (
            <label className="mt-1 flex items-start gap-2 text-sm">
              <input type="checkbox" name="notSent" defaultChecked className="mt-0.5 size-4" />
              <span>
                {w.notSent}
                <span className="block text-xs text-muted">{countWords(unitsToSend, w.notSentHint)}</span>
              </span>
            </label>
          )}
        </fieldset>
      )}
      {hasEmail && canRefund && !(outside && !outside.allowed) && (notifyOff ? <NotifySwitchedOff href={notifyOff}>{w.emailRefund}</NotifySwitchedOff> : <Notify>{w.emailRefund}</Notify>)}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || Boolean(outside && !outside.allowed)} className={primary}>
          {pending ? (outside ? w.recording : w.refunding) : outside ? w.recordRefund : w.refund}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Cancels a paid order before it is sent; asks first. */
export function CancelForm({
  storeSlug,
  orderId,
  amountLabel,
  hasEmail,
  unpaid = false,
  outside = false,
  notifyOff = null,
}: Ids & {
  /** The cancellation email is switched off in Notifications (D238). */
  notifyOff?: string | null;
  amountLabel: string;
  hasEmail: boolean;
  /** Not charged yet (a weekly delivery, D102): nothing to refund. */
  unpaid?: boolean;
  /** Taken outside Kaizen (D173): the refund is recorded, staff pay the customer back themselves. */
  outside?: boolean;
}) {
  const [state, action, pending] = useActionState(cancelOrderAction.bind(null, storeSlug, orderId), initial);
  const w = useAdminText("order").forms;
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const question = unpaid
          ? w.confirmCancelUnpaid
          : outside
            ? fillWords(w.confirmCancelOutside, { amount: amountLabel })
            : fillWords(w.confirmCancel, { amount: amountLabel });
        if (!window.confirm(question)) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-muted">
        {unpaid ? (
          w.cancelUnpaidText
        ) : outside ? (
          fillWords(w.cancelOutsideText, { amount: amountLabel })
        ) : (
          fillWords(w.cancelText, { amount: amountLabel })
        )}
      </p>
      <label className={label}>
        <span>
          {w.reason} <span className="font-normal text-muted">{w.forRecords}</span>
        </span>
        <input name="reason" maxLength={500} className={input} />
      </label>
      {hasEmail && (notifyOff ? <NotifySwitchedOff href={notifyOff}>{w.emailCancelled}</NotifySwitchedOff> : <Notify>{w.emailCancelled}</Notify>)}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? w.cancelling : w.cancelOrder}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Records what was left to pay at the venue as paid (D66). */
export function BalanceForm({ storeSlug, orderId, amountLabel }: Ids & { amountLabel: string }) {
  const [state, action, pending] = useActionState(markBalancePaidAction.bind(null, storeSlug, orderId), initial);
  const w = useAdminText("order").forms;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className={label}>
        {w.paidWith}
        <select name="method" defaultValue="card" className={input}>
          <option value="card">{w.cardTerminal}</option>
          <option value="cash">{w.cash}</option>
          <option value="other">{w.other}</option>
        </select>
      </label>
      <button type="submit" disabled={pending} className={primary}>
        {pending ? w.saving : fillWords(w.markPaid, { amount: amountLabel })}
      </button>
      <Result state={state} />
    </form>
  );
}

/** Records the invoice of an order on payment terms as paid outside Kaizena Flow (D293): how, the day it arrived and a reference. */
export function TermsPaidForm({ storeSlug, orderId, amountLabel, today }: Ids & { amountLabel: string; today: string }) {
  const [state, action, pending] = useActionState(recordTermsPaidAction.bind(null, storeSlug, orderId), initial);
  const words = useAdminText("order");
  const w = words.forms;
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className={label}>
          {w.paidBy}
          <select name="method" defaultValue="bank_transfer" className={input}>
            {MANUAL_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {words.manualMethods[method]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {w.receivedOn}
          <input type="date" name="receivedOn" defaultValue={today} max={today} className={input} />
        </label>
        <label className={`${label} min-w-48 flex-1`}>
          {w.reference}
          <input name="reference" maxLength={200} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? w.saving : fillWords(w.recordPaid, { amount: amountLabel })}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

export type ContactValues = {
  email: string;
  name: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  phone: string;
};

/** Corrects the customer's email and delivery address. */
export function ContactForm({ storeSlug, orderId, values }: Ids & { values: ContactValues }) {
  const [state, action, pending] = useActionState(updateContactAction.bind(null, storeSlug, orderId), initial);
  const w = useAdminText("order").forms;
  const field = (name: keyof ContactValues, text: string, extra: Record<string, string> = {}) => (
    <label className={label}>
      {text}
      <input name={name} defaultValue={values[name]} className={input} {...extra} />
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {field("email", w.email, { type: "email", required: "true", autoComplete: "off" })}
      {field("name", w.name)}
      {field("line1", w.address)}
      {field("line2", w.address2)}
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        {field("postalCode", w.postcode)}
        {field("city", w.city)}
      </div>
      {field("phone", w.phone, { type: "tel" })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? w.saving : w.save}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** A note for staff only. */
export function NoteForm({ storeSlug, orderId }: Ids) {
  const form = useRef<HTMLFormElement>(null);
  const w = useAdminText("order").forms;
  const [state, action, pending] = useActionState(async (previous: OrderActionState, data: FormData) => {
    const result = await addNoteAction(storeSlug, orderId, previous, data);
    if (result.ok) form.current?.reset();
    return result;
  }, initial);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <label className={label}>
        <span>
          {w.addNote} <span className="font-normal text-muted">{w.staffOnly}</span>
        </span>
        <textarea name="note" rows={2} maxLength={2000} className={`${input} py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? w.saving : w.addNoteButton}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Sends the order confirmation to the customer again. */
export function ResendButton({ storeSlug, orderId }: Ids) {
  const [state, action, pending] = useActionState(
    async (): Promise<OrderActionState> => resendConfirmationAction(storeSlug, orderId),
    initial,
  );
  const w = useAdminText("order").forms;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? w.sending : w.resend}
      </button>
      <Result state={state} />
    </form>
  );
}
