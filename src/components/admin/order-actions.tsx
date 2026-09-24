"use client";

import { useActionState, useRef, useState, type ReactNode } from "react";

import {
  addNoteAction,
  cancelOrderAction,
  refundOrderAction,
  resendConfirmationAction,
  sendOrderAction,
  updateContactAction,
  type OrderActionState,
} from "@/app/admin/(gated)/[store]/orders/actions";

const initial: OrderActionState = { ok: false, message: null };
const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const primary = "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50";
const secondary = "min-h-10 rounded-md border border-border px-4 text-sm disabled:opacity-50";

type Ids = { storeSlug: string; orderId: string };

function Result({ state }: { state: OrderActionState }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm empty:hidden ${state.ok ? "" : "text-red-700 dark:text-red-400"}`}
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

/** Marks the order as sent with the parcel's carrier and tracking number. */
export function SendForm({ storeSlug, orderId, carriers, hasEmail }: Ids & { carriers: { id: string; name: string }[]; hasEmail: boolean }) {
  const [state, action, pending] = useActionState(sendOrderAction.bind(null, storeSlug, orderId), initial);
  const [carrier, setCarrier] = useState(carriers[0]?.id ?? "other");
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className={label}>
          Carrier
          <select name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={input}>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span>
            Tracking number <span className="font-normal text-muted">(optional)</span>
          </span>
          <input name="trackingNumber" autoComplete="off" spellCheck={false} className={`${input} font-mono`} />
        </label>
      </div>
      {carrier === "other" && (
        <label className={label}>
          <span>
            Tracking link <span className="font-normal text-muted">(optional)</span>
          </span>
          <input name="trackingUrl" type="url" placeholder="https://…" className={input} />
        </label>
      )}
      {hasEmail && <Notify>Email the customer that it is on its way</Notify>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Saving …" : "Mark as sent"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Refunds any amount up to what is left, and puts chosen items back in stock. */
export function RefundForm({
  storeSlug,
  orderId,
  refundable,
  refundableLabel,
  lines,
  hasEmail,
  canRefund,
}: Ids & {
  refundable: string;
  refundableLabel: string;
  lines: { id: string; title: string; left: number }[];
  hasEmail: boolean;
  canRefund: boolean;
}) {
  const [state, action, pending] = useActionState(refundOrderAction.bind(null, storeSlug, orderId), initial);
  const [amount, setAmount] = useState("");
  return (
    <form action={action} className="flex flex-col gap-3">
      {canRefund ? (
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            Amount to refund
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
            Everything left ({refundableLabel})
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">This payment was not taken through Kaizen&apos;s Stripe, so refund it in Stripe.</p>
      )}
      <label className={label}>
        <span>
          Reason <span className="font-normal text-muted">(for your records)</span>
        </span>
        <input name="reason" maxLength={500} className={input} />
      </label>
      {lines.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Put back in stock</legend>
          {lines.map((line) => (
            <label key={line.id} className="flex items-center justify-between gap-3 text-sm">
              <span>{line.title}</span>
              <input
                type="number"
                name={`restock:${line.id}`}
                min={0}
                max={line.left}
                defaultValue={0}
                aria-label={`Units of ${line.title} to put back in stock`}
                className={`${input} w-20`}
              />
            </label>
          ))}
        </fieldset>
      )}
      {hasEmail && canRefund && <Notify>Email the customer about the refund</Notify>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Refunding …" : "Refund"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** Cancels a paid order before it is sent; asks first. */
export function CancelForm({ storeSlug, orderId, amountLabel, hasEmail }: Ids & { amountLabel: string; hasEmail: boolean }) {
  const [state, action, pending] = useActionState(cancelOrderAction.bind(null, storeSlug, orderId), initial);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Cancel the order and refund ${amountLabel}? Items go back in stock.`)) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-muted">
        Refunds {amountLabel}, puts every item back in stock and stops download links.
      </p>
      <label className={label}>
        <span>
          Reason <span className="font-normal text-muted">(for your records)</span>
        </span>
        <input name="reason" maxLength={500} className={input} />
      </label>
      {hasEmail && <Notify>Email the customer that the order is cancelled</Notify>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? "Cancelling …" : "Cancel order"}
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
  const field = (name: keyof ContactValues, text: string, extra: Record<string, string> = {}) => (
    <label className={label}>
      {text}
      <input name={name} defaultValue={values[name]} className={input} {...extra} />
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      {field("email", "Email", { type: "email", required: "true", autoComplete: "off" })}
      {field("name", "Name")}
      {field("line1", "Address")}
      {field("line2", "Address, line 2")}
      <div className="grid grid-cols-[7rem_1fr] gap-2">
        {field("postalCode", "Postcode")}
        {field("city", "City")}
      </div>
      {field("phone", "Phone", { type: "tel" })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? "Saving …" : "Save"}
        </button>
        <Result state={state} />
      </div>
    </form>
  );
}

/** A note for staff only. */
export function NoteForm({ storeSlug, orderId }: Ids) {
  const form = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (previous: OrderActionState, data: FormData) => {
    const result = await addNoteAction(storeSlug, orderId, previous, data);
    if (result.ok) form.current?.reset();
    return result;
  }, initial);
  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      <label className={label}>
        <span>
          Add a note <span className="font-normal text-muted">(only staff see it)</span>
        </span>
        <textarea name="note" rows={2} maxLength={2000} className={`${input} py-2`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? "Saving …" : "Add note"}
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
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button type="submit" disabled={pending} className={secondary}>
        {pending ? "Sending …" : "Send confirmation again"}
      </button>
      <Result state={state} />
    </form>
  );
}
