"use client";

import { useActionState, useState } from "react";

import type { OrderActionState } from "@/app/admin/(gated)/[store]/orders/actions";
import { field, hint, primary } from "@/components/admin/data/ui";
import { NotifySwitchedOff } from "@/components/admin/orders/notify-off";
import { useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";

/** A physical line as the *Send* card shows it (D174 2.1): what was ordered, sent, withdrawn before sending and what is left. */
export type ParcelRow = {
  lineId: string;
  title: string;
  sku: string;
  ordered: number;
  sent: number;
  withdrawn: number;
  /** Units taken off what is still to send because they will not be sent (D174, refunded or put back as not sent); absent is 0. */
  closed?: number;
  toSend: number;
  /** Units sold on backorder that are still to send (D172), and the days the customer was told. */
  backordered: number;
  backorderDays: number | null;
};

const initial: OrderActionState = { ok: false, message: null };

/** Why a line has nothing in this parcel, in words. */
function nothingLeft(row: ParcelRow, w: OrderMessages["send"] = orderEn.send): string {
  if ((row.closed ?? 0) > 0) return row.sent === 0 ? w.willNotBeSent : w.restWillNotBeSent;
  if (row.withdrawn > 0 && row.sent === 0) return w.withdrawnBefore;
  if (row.withdrawn > 0) return w.restWithdrawn;
  return w.allSent;
}

/**
 * The *Send* card's form (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1): a table of the order's physical lines with what was ordered, sent, withdrawn before sending
 * and is still to send, and *In this parcel* for each line that has units left (it starts at what is left; 0 leaves the line out of this parcel). Then the carrier, the
 * tracking and *Tell the customer*. The server checks the parcel again under the order's lock and refuses with a sentence; `basis` is the order's fulfilment as this card
 * saw it, so a parcel or withdrawal recorded meanwhile is refused as changed. A weekly box (`whole`) is sent whole: no quantities are offered. Downloads and services are
 * never listed. English: the admin.
 */
export function SendParcelForm({
  rows,
  basis,
  carriers,
  hasEmail,
  whole = false,
  submitLabel,
  send,
  notifyOff = null,
}: {
  /** The *Order sent* email is switched off in Notifications (D238): the box is drawn off, linking there. */
  notifyOff?: string | null;
  rows: ParcelRow[];
  basis: string;
  carriers: { id: string; name: string }[];
  hasEmail: boolean;
  /** A subscription box delivery (D102): sent whole, charged first. */
  whole?: boolean;
  submitLabel?: string;
  send: (previous: OrderActionState, form: FormData) => Promise<OrderActionState>;
}) {
  const [state, action, pending] = useActionState(send, initial);
  const words = useAdminText("order");
  const w = words.send;
  const [carrier, setCarrier] = useState(carriers[0]?.id ?? "other");
  const left = rows.reduce((sum, r) => sum + r.toSend, 0);
  return (
    <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
      <input type="hidden" name="seen" value={basis} />
      {!whole && <input type="hidden" name="parcel" value="lines" />}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 font-medium">{w.item}</th>
                <th scope="col" className="py-2 text-right font-medium">{w.ordered}</th>
                <th scope="col" className="py-2 text-right font-medium">{w.sent}</th>
                <th scope="col" className="py-2 text-right font-medium">{w.withdrawn}</th>
                <th scope="col" className="py-2 text-right font-medium">{w.toSend}</th>
                <th scope="col" className="py-2 pl-3 text-right font-medium">{whole ? w.sentNow : w.inThisParcel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.lineId} className={`border-b border-line ${row.toSend === 0 ? "text-muted" : ""}`}>
                  <td className="py-2">
                    {row.title}
                    {row.sku && <span className="block font-mono text-xs text-muted">{row.sku}</span>}
                    {(row.closed ?? 0) > 0 && <span className="block text-xs text-muted">{fillWords(w.closedUnits, { n: row.closed ?? 0 })}</span>}
                    {row.backordered > 0 && row.toSend > 0 && (
                      <span className="block text-xs font-medium">
                        {fillWords(w.onBackorder, { n: row.backordered, days: row.backorderDays ? countWords(row.backorderDays, w.within) : "" })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">{row.ordered}</td>
                  <td className="py-2 text-right tabular-nums">{row.sent}</td>
                  <td className="py-2 text-right tabular-nums">{row.withdrawn}</td>
                  <td className="py-2 text-right tabular-nums">{row.toSend}</td>
                  <td className="py-2 pl-3 text-right">
                    {row.toSend === 0 ? (
                      <span className="text-xs">{nothingLeft(row, w)}</span>
                    ) : whole ? (
                      <span className="tabular-nums">{row.toSend}</span>
                    ) : (
                      <input
                        type="number"
                        name={`qty:${row.lineId}`}
                        inputMode="numeric"
                        min={0}
                        max={row.toSend}
                        step={1}
                        defaultValue={row.toSend}
                        aria-label={fillWords(w.inThisParcelOf, { title: row.title })}
                        className={`${field} w-20 text-right tabular-nums`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {whole ? (
        <p className={hint}>{w.whole}</p>
      ) : (
        <p className={hint}>{countWords(left, w.leftHint)}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.carrier}
          <select name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={field}>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>
            {w.trackingNumber} <span className="font-normal text-muted">{w.optional}</span>
          </span>
          <input name="trackingNumber" autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
        </label>
      </div>
      {carrier === "other" && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>
            {w.trackingLink} <span className="font-normal text-muted">{w.optional}</span>
          </span>
          <input name="trackingUrl" type="url" placeholder="https://…" className={field} />
        </label>
      )}
      {hasEmail && notifyOff && <NotifySwitchedOff href={notifyOff}>{w.tell}</NotifySwitchedOff>}
      {hasEmail && !notifyOff && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" defaultChecked className="size-4" />
          {w.tell}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || left === 0} className={primary}>
          {pending ? w.saving : (submitLabel ?? words.page.sendThis)}
        </button>
        <p role="status" aria-live="polite" className={`text-sm empty:hidden ${state.ok ? "" : "text-danger-text "}`}>
          {state.message}
        </p>
      </div>
    </form>
  );
}
