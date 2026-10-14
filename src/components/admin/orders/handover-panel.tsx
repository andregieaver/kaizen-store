import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { LocalDelivery, PickupDelivery } from "@/lib/delivery-options";
import { parseOpeningHours } from "@/lib/opening-hours-schema";
import { weekSummary } from "@/lib/opening-hours";
import { readyInWords } from "@/lib/pickup";

/**
 * The order page's card for an order collected at the store's place or delivered by its own drivers (D237, `docs/wave-3-shipping-methods.md` 2.2,
 * 2.3): where (the snapshot kept on the order, so a place edited since changes nothing), what happened (ready, collected, taken out), and the buttons
 * staff press. A pickup order is never sent as a parcel; a mistaken handover is taken back with Undo in the list of what was handed over.
 * Presentational: the page binds the actions and passes the order's state.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type HandoverState = {
  status: string;
  copied: boolean;
  /** Units still to hand over (D174's `toSend()`); 0 once collected or taken out. */
  unitsToSend: number;
  /** Units sold on backorder and not received (D172): staff confirm they have them. */
  waitingUnits: number;
  editPending: boolean;
  /** D174's basis as the page saw it, sent back so a press after another person's answers *changed*. */
  basis: string;
  /** The receipt day when recorded (collected, or delivered). */
  deliveredOn: string | null;
};

const readyWords = (hours: number): string => {
  const words = readyInWords(hours);
  if (words.key === "notify") return "No time promised: the customer waits for the email.";
  return words.key === "hours" ? `Usually ready in ${words.count} ${words.count === 1 ? "hour" : "hours"}.` : `Usually ready in ${words.count} ${words.count === 1 ? "day" : "days"}.`;
};

function StockConfirm({ units }: { units: number }) {
  if (units <= 0) return null;
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="haveStock" className="mt-1" />
      <span>
        {units} {units === 1 ? "unit was" : "units were"} sold on backorder. Tick when you have {units === 1 ? "it" : "them"} here.
      </span>
    </label>
  );
}

export function PickupPanel({
  delivery,
  readyAt,
  state,
  canWrite,
  today,
  when,
  ready,
  collected,
}: {
  delivery: PickupDelivery | null;
  readyAt: string | null;
  state: HandoverState;
  canWrite: boolean;
  /** The store's today (`YYYY-MM-DD`), the day field's default and latest. */
  today: string;
  when: (iso: string) => string;
  ready: Action;
  collected: Action;
}) {
  const hours = parseOpeningHours(delivery?.hours ?? null);
  const live = (state.status === "paid" || state.status === "fulfilled") && !state.copied;
  const isCollected = state.status === "fulfilled" || state.unitsToSend === 0;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {delivery ? (
        <div>
          <p className="text-body-strong text-ink">Collect at {delivery.name}</p>
          <p className="text-ink-2">{[delivery.street, `${delivery.postalCode} ${delivery.city}`.trim()].filter(Boolean).join(", ")}</p>
          {hours && <p className="text-ink-2">Opening hours: {weekSummary(hours.week)}</p>}
          <p className="text-muted">{readyWords(delivery.readyInHours)}</p>
          {delivery.instructions && <p className="mt-2 whitespace-pre-line rounded-panel bg-sunken p-3">{delivery.instructions}</p>}
        </div>
      ) : (
        <p className="text-muted">Collected at one of your places (its details were not kept on this order).</p>
      )}
      <ul className="flex flex-col gap-1">
        <li>{readyAt ? `Marked ready for pickup ${when(readyAt)}.` : "Not marked ready yet."}</li>
        {state.deliveredOn && <li>Collected on {state.deliveredOn}.</li>}
      </ul>
      {state.copied ? (
        <p className="text-muted">A copied order is history and is never handed over.</p>
      ) : !canWrite || !live ? null : state.editPending ? (
        <p className="text-muted">A change to this order waits for the customer&apos;s payment. Nothing is handed over until it is paid, cancelled or expired.</p>
      ) : isCollected ? (
        readyAt && (
          <p className="text-muted">The order was collected. A mistake is taken back with Undo under Handed over.</p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {!readyAt ? (
            <ActionForm action={ready} className="flex flex-col gap-2">
              <input type="hidden" name="seen" value={state.basis} />
              <StockConfirm units={state.waitingUnits} />
              <p className="text-muted">Emails the customer once, in the order&apos;s language, with the address, opening hours and your instructions.</p>
              <div>
                <SubmitButton>Ready for pickup</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <ActionForm action={ready} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="resend" value="1" />
              <SubmitButton variant="secondary">Send the email again</SubmitButton>
              <span className="text-muted">Sent only if the first email failed.</span>
            </ActionForm>
          )}
          <ActionForm action={collected} className="flex flex-col gap-2 border-t border-line pt-4">
            <input type="hidden" name="seen" value={state.basis} />
            <StockConfirm units={state.waitingUnits} />
            <label className="flex flex-col gap-1">
              Collected on
              <input type="date" name="on" defaultValue={today} max={today} className="min-h-10 max-w-48 rounded-md border border-line bg-card px-3" />
            </label>
            <p className="text-muted">Hands over every item still here and fulfils the order. That day starts the 14 days to withdraw. No email is sent.</p>
            <div>
              <SubmitButton variant="secondary">Collected</SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

export function LocalDeliveryPanel({
  delivery,
  note,
  phone,
  takenOutAt,
  state,
  canWrite,
  when,
  today,
  out,
  delivered,
}: {
  delivery: LocalDelivery | null;
  note: string | null;
  phone: string | null;
  /** When it was taken out (the live `local` handover), or null. */
  takenOutAt: string | null;
  state: HandoverState;
  canWrite: boolean;
  when: (iso: string) => string;
  today: string;
  out: Action;
  /** *Mark delivered* (`markDelivered()`): on an order never taken out it writes the handover first, so one press is enough. */
  delivered: Action;
}) {
  const live = (state.status === "paid" || state.status === "fulfilled") && !state.copied;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-body-strong text-ink">Local delivery{delivery ? `: ${delivery.name}` : ""}</p>
        {delivery?.postalCode && <p className="text-ink-2">Priced for postal code {delivery.postalCode}</p>}
        {delivery?.info && <p className="text-muted">{delivery.info}</p>}
        {phone && <p className="text-ink-2">Phone: {phone}</p>}
      </div>
      {note && (
        <div>
          <p className="text-body-strong text-ink">Note for the driver</p>
          <p className="whitespace-pre-line rounded-panel bg-sunken p-3">{note}</p>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        <li>{takenOutAt ? `Out for delivery ${when(takenOutAt)}.` : "Not taken out yet."}</li>
        {state.deliveredOn && <li>Delivered on {state.deliveredOn}.</li>}
      </ul>
      {state.copied ? (
        <p className="text-muted">A copied order is history and is never delivered.</p>
      ) : !canWrite || !live ? null : state.editPending ? (
        <p className="text-muted">A change to this order waits for the customer&apos;s payment. Nothing is taken out until it is paid, cancelled or expired.</p>
      ) : state.waitingUnits > 0 ? (
        <p className="text-muted">Part of this order is waiting for stock. It can be taken out when every item is here.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {state.unitsToSend > 0 && (
            <ActionForm action={out} className="flex flex-col gap-2">
              <input type="hidden" name="seen" value={state.basis} />
              <p className="text-muted">Records that the order left with your driver, fulfils it and emails the customer.</p>
              <div>
                <SubmitButton>Out for delivery</SubmitButton>
              </div>
            </ActionForm>
          )}
          {!state.deliveredOn && (
            <ActionForm action={delivered} className="flex flex-col gap-2 border-t border-line pt-4">
              <label className="flex flex-col gap-1">
                Delivered on
                <input type="date" name="on" defaultValue={today} max={today} className="min-h-10 max-w-48 rounded-md border border-line bg-card px-3" />
              </label>
              <p className="text-muted">
                {state.unitsToSend > 0 ? "Records the handover and the delivery in one go, for a driver who delivers at once. " : ""}That day starts the 14 days to withdraw.
              </p>
              <div>
                <SubmitButton variant="secondary">Mark delivered</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
