import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { LocalDelivery, PickupDelivery } from "@/lib/delivery-options";
import { parseOpeningHours } from "@/lib/opening-hours-schema";
import { weekSummary } from "@/lib/opening-hours";
import { readyInWords } from "@/lib/pickup";
import { countWords, fillWords } from "@/lib/admin-fill";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";

type Words = OrderMessages["handover"];

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

const readyWords = (hours: number, w: Words): string => {
  const words = readyInWords(hours);
  if (words.key === "notify") return w.notify;
  return countWords(words.count, words.key === "hours" ? w.readyHours : w.readyDays);
};

function StockConfirm({ units, w }: { units: number; w: Words }) {
  if (units <= 0) return null;
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name="haveStock" className="mt-1" />
      <span>{countWords(units, w.stockConfirm)}</span>
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
  words: w = orderEn.handover,
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
  words?: Words;
}) {
  const hours = parseOpeningHours(delivery?.hours ?? null);
  const live = (state.status === "paid" || state.status === "authorized" || state.status === "fulfilled") && !state.copied;
  const isCollected = state.status === "fulfilled" || state.unitsToSend === 0;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {delivery ? (
        <div>
          <p className="text-body-strong text-ink">{fillWords(w.collectAt, { name: delivery.name })}</p>
          <p className="text-ink-2">{[delivery.street, `${delivery.postalCode} ${delivery.city}`.trim()].filter(Boolean).join(", ")}</p>
          {hours && <p className="text-ink-2">{fillWords(w.openingHours, { hours: weekSummary(hours.week) })}</p>}
          <p className="text-muted">{readyWords(delivery.readyInHours, w)}</p>
          {delivery.instructions && <p className="mt-2 whitespace-pre-line rounded-panel bg-sunken p-3">{delivery.instructions}</p>}
        </div>
      ) : (
        <p className="text-muted">{w.placeUnknown}</p>
      )}
      <ul className="flex flex-col gap-1">
        <li>{readyAt ? fillWords(w.markedReady, { when: when(readyAt) }) : w.notReady}</li>
        {state.deliveredOn && <li>{fillWords(w.collectedOn, { day: state.deliveredOn })}</li>}
      </ul>
      {state.copied ? (
        <p className="text-muted">{w.copiedPickup}</p>
      ) : !canWrite || !live ? null : state.editPending ? (
        <p className="text-muted">{w.changeWaitsHandover}</p>
      ) : isCollected ? (
        readyAt && (
          <p className="text-muted">{w.wasCollected}</p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {!readyAt ? (
            <ActionForm action={ready} className="flex flex-col gap-2">
              <input type="hidden" name="seen" value={state.basis} />
              <StockConfirm units={state.waitingUnits} w={w} />
              <p className="text-muted">{w.readyEmail}</p>
              <div>
                <SubmitButton>{w.ready}</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <ActionForm action={ready} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="resend" value="1" />
              <SubmitButton variant="secondary">{w.sendAgain}</SubmitButton>
              <span className="text-muted">{w.onlyIfFailed}</span>
            </ActionForm>
          )}
          <ActionForm action={collected} className="flex flex-col gap-2 border-t border-line pt-4">
            <input type="hidden" name="seen" value={state.basis} />
            <StockConfirm units={state.waitingUnits} w={w} />
            <label className="flex flex-col gap-1">
              {w.collectedOnLabel}
              <input type="date" name="on" defaultValue={today} max={today} className="min-h-10 max-w-48 rounded-md border border-line bg-card px-3" />
            </label>
            <p className="text-muted">{w.collectedText}</p>
            <div>
              <SubmitButton variant="secondary">{w.collected}</SubmitButton>
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
  words: w = orderEn.handover,
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
  words?: Words;
}) {
  const live = (state.status === "paid" || state.status === "authorized" || state.status === "fulfilled") && !state.copied;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div>
        <p className="text-body-strong text-ink">{delivery ? fillWords(w.localNamed, { name: delivery.name }) : w.local}</p>
        {delivery?.postalCode && <p className="text-ink-2">{fillWords(w.pricedFor, { code: delivery.postalCode })}</p>}
        {delivery?.info && <p className="text-muted">{delivery.info}</p>}
        {phone && <p className="text-ink-2">{fillWords(w.phone, { phone })}</p>}
      </div>
      {note && (
        <div>
          <p className="text-body-strong text-ink">{w.driverNote}</p>
          <p className="whitespace-pre-line rounded-panel bg-sunken p-3">{note}</p>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        <li>{takenOutAt ? fillWords(w.outAt, { when: when(takenOutAt) }) : w.notOut}</li>
        {state.deliveredOn && <li>{fillWords(w.deliveredOn, { day: state.deliveredOn })}</li>}
      </ul>
      {state.copied ? (
        <p className="text-muted">{w.copiedLocal}</p>
      ) : !canWrite || !live ? null : state.editPending ? (
        <p className="text-muted">{w.changeWaitsOut}</p>
      ) : state.waitingUnits > 0 ? (
        <p className="text-muted">{w.waitingStock}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {state.unitsToSend > 0 && (
            <ActionForm action={out} className="flex flex-col gap-2">
              <input type="hidden" name="seen" value={state.basis} />
              <p className="text-muted">{w.outText}</p>
              <div>
                <SubmitButton>{w.out}</SubmitButton>
              </div>
            </ActionForm>
          )}
          {!state.deliveredOn && (
            <ActionForm action={delivered} className="flex flex-col gap-2 border-t border-line pt-4">
              <label className="flex flex-col gap-1">
                {w.deliveredOnLabel}
                <input type="date" name="on" defaultValue={today} max={today} className="min-h-10 max-w-48 rounded-md border border-line bg-card px-3" />
              </label>
              <p className="text-muted">
                {state.unitsToSend > 0 ? w.oneGo : ""}
                {w.startsWithdraw}
              </p>
              <div>
                <SubmitButton variant="secondary">{w.markDelivered}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}
