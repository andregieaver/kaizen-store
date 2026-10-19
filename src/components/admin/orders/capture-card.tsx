"use client";

import { useActionState } from "react";

import type { OrderActionState } from "@/app/admin/(gated)/[store]/orders/actions";
import { Card } from "@/components/admin/ui";

const initial: OrderActionState = { ok: false, message: null };
const field = "min-h-10 w-40 rounded-md border border-line bg-card px-3 text-sm";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm text-brand-ink disabled:opacity-50";
const secondary = "min-h-10 rounded-pill border border-edge px-4 text-sm disabled:opacity-50";

type Action = (state: OrderActionState, form: FormData) => Promise<OrderActionState>;

function Result({ state }: { state: OrderActionState }) {
  return (
    <p role="status" aria-live="polite" className={`text-sm empty:hidden ${state.ok ? "" : "text-danger-text"}`}>
      {state.message}
    </p>
  );
}

/**
 * A held card on the order page (wave 4 unit B, D289, `docs/wave-4-payments.md` 4): what is held and until when, *Capture* (the whole, or less: the rest
 * is released) and *Cancel and release*. With the store's *When the order is sent*, recording the first parcel captures it too. Read-only without
 * `orders:write` (no actions passed).
 */
export function CaptureCard({
  heldLabel,
  heldTyped,
  currency,
  deadline,
  whenSent,
  hasEmail,
  capture,
  release,
}: {
  heldLabel: string;
  /** What is held as typed in the amount field (`1234,50`). */
  heldTyped: string;
  currency: string;
  /** When the hold ends, in the store's time zone. */
  deadline: string;
  whenSent: boolean;
  hasEmail: boolean;
  capture: Action | null;
  release: Action | null;
}) {
  return (
    <Card title="Card held, to capture" className="text-sm">
      <p>
        {heldLabel} is held on the customer&apos;s card, not charged. The hold ends {deadline}; an order not captured by then is cancelled and its items
        are no longer held.
      </p>
      <p className="mt-2 text-muted">
        {whenSent ? "Recording the first parcel or handover captures it. You can also capture it now." : "Nothing is charged until you capture it."} It is not a sale in your figures and has no invoice until then.
      </p>
      {capture && <CaptureForm action={capture} heldTyped={heldTyped} currency={currency} heldLabel={heldLabel} />}
      {release && <ReleaseForm action={release} hasEmail={hasEmail} />}
    </Card>
  );
}

function CaptureForm({ action, heldTyped, currency, heldLabel }: { action: Action; heldTyped: string; currency: string; heldLabel: string }) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form
      action={run}
      onSubmit={(event) => {
        const typed = String(new FormData(event.currentTarget).get("amount") ?? "").trim();
        if (!window.confirm(typed && typed !== heldTyped ? `Capture ${typed} ${currency}? The rest of the hold is released.` : `Capture ${heldLabel}?`)) event.preventDefault();
      }}
      className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
    >
      <label className="flex flex-col gap-1">
        <span>
          Amount to capture <span className="text-muted">({currency}, at most what is held)</span>
        </span>
        <input name="amount" inputMode="decimal" defaultValue={heldTyped} className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className={primary}>
          Capture
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

function ReleaseForm({ action, hasEmail }: { action: Action; hasEmail: boolean }) {
  const [state, run, pending] = useActionState(action, initial);
  return (
    <form
      action={run}
      onSubmit={(event) => {
        if (!window.confirm("Cancel the order and release the hold? Nothing is charged, and its items are no longer held.")) event.preventDefault();
      }}
      className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
    >
      {hasEmail && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="notify" defaultChecked className="size-4" />
          Tell the customer the order is cancelled
        </label>
      )}
      <div>
        <button type="submit" disabled={pending} className={secondary}>
          Cancel and release
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}
