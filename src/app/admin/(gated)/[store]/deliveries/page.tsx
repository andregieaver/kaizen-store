import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatMoney } from "@/lib/money";
import { cutoffWeekday, formatCutoff, formatDeliveryDate, WEEKDAYS, weekdayName, type DeliverySchedule } from "@/lib/standing-orders";
import { requireMember } from "@/server/auth";
import { deliveryRounds, listStandingOrders, type ScheduleView } from "@/server/standing-orders";

import { saveScheduleAction } from "./actions";

export const metadata: Metadata = { title: "Weekly deliveries" };

const card = "rounded-lg border border-border bg-background p-5";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

const LIST_STATUS: Record<string, string> = { active: "On", paused: "Paused", cancelled: "Ended", setup: "Saving card" };
const ORDER_STATUS: Record<string, string> = {
  pending_payment: "To send: charged when sent",
  paid: "Paid, to send",
  fulfilled: "Sent and paid",
  cancelled: "Cancelled",
  closed: "Closed",
};

/**
 * Weekly deliveries (D102): the store's delivery days, each round's orders
 * (made at its cutoff, charged when sent), and the shoppers' lists.
 */
export default async function DeliveriesPage({ params }: PageProps<"/admin/[store]/deliveries">) {
  const { store, role } = await requireMember((await params).store);
  const owner = role === "owner";
  const [rounds, lists] = await Promise.all([deliveryRounds(store.id), listStandingOrders(store.id)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const when = (at: number) => formatCutoff(at, locale, store.timeZone);
  const day = (date: string) => formatDeliveryDate(date, locale);
  const currencyOf = (schedule: ScheduleView) => schedule.currency;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekly deliveries</h1>
        <p className="text-sm text-muted">
          At each cutoff, shoppers&apos; lists become that delivery&apos;s orders at the day&apos;s prices, with their stock held. Send each
          order from its page: the customer&apos;s card is charged as you mark it sent. Times are in {store.timeZone.replace("_", " ")}.
        </p>
        {!store.deliveriesOn && (
          <p className="mt-2 text-sm">
            Weekly deliveries are off.{" "}
            <Link href={`/admin/${store.slug}/settings/features`} className="underline">
              Switch them on under Features
            </Link>
            .
          </p>
        )}
      </div>

      {rounds.map(({ schedule, current, next }) => (
        <section key={schedule.id} aria-label={schedule.name} className={card}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {schedule.name} <span className="font-normal text-muted">· {schedule.marketCode}</span>
              {!schedule.active && <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-xs text-muted">Off</span>}
            </h2>
            <p className="text-sm text-muted">
              {schedule.lists} {schedule.lists === 1 ? "list" : "lists"} · next cutoff {when(next.cutoffAt)} for {day(next.date)}
            </p>
          </div>
          {current ? (
            <>
              <h3 className="mb-2 text-sm font-medium">
                {day(current.date)}: {current.orders.length} {current.orders.length === 1 ? "order" : "orders"}
                {current.skipped > 0 && <span className="font-normal text-muted"> · {current.skipped} without a delivery (skipped, paused or empty)</span>}
              </h3>
              {current.orders.length === 0 ? (
                <p className="text-sm text-muted">No orders for this delivery.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th scope="col" className="py-2 pr-4 font-medium">Order</th>
                        <th scope="col" className="py-2 pr-4 font-medium">Customer</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">Items</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">Total</th>
                        <th scope="col" className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.orders.map((order) => (
                        <tr key={order.orderId} className="border-b border-border last:border-0">
                          <td className="py-2 pr-4">
                            <Link href={`/admin/${store.slug}/orders/${order.orderId}`} className="underline">
                              #{order.number}
                            </Link>
                          </td>
                          <td className="py-2 pr-4">{order.name || "–"}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{order.items}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(order.totalMinor, currencyOf(schedule), locale)}</td>
                          <td className="py-2">{ORDER_STATUS[order.status] ?? order.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">Nothing being packed now: the next orders are made at the cutoff.</p>
          )}
          {owner && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm underline">Change this delivery day</summary>
              <div className="mt-3">
                <ScheduleForm storeSlug={store.slug} schedule={schedule} markets={store.markets.map((m) => m.code)} />
              </div>
            </details>
          )}
        </section>
      ))}

      {owner && (
        <section aria-labelledby="add-day" className={card}>
          <h2 id="add-day" className="mb-1 font-medium">
            {rounds.length === 0 ? "Add your first delivery day" : "Add a delivery day"}
          </h2>
          <p className="mb-4 text-sm text-muted">
            One day of the week in one market. Shoppers choose it when they start their weekly delivery, and can change it later.
          </p>
          <ScheduleForm storeSlug={store.slug} schedule={null} markets={store.markets.map((m) => m.code)} />
        </section>
      )}

      <section aria-labelledby="lists" className={card}>
        <h2 id="lists" className="mb-3 font-medium">
          Lists
        </h2>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">No shopper has started a weekly delivery yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">Customer</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Delivery day</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Items</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Card</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/${store.slug}/customers/${list.customerId}`} className="underline">
                        {list.name || list.email}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{list.schedule}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {list.items} <span className="text-muted">({list.lines} kinds)</span>
                    </td>
                    <td className="py-2 pr-4">{list.cardLabel || "–"}</td>
                    <td className="py-2">{LIST_STATUS[list.status] ?? list.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleForm({
  storeSlug,
  schedule,
  markets,
}: {
  storeSlug: string;
  schedule: ScheduleView | null;
  markets: string[];
}) {
  const values: DeliverySchedule & { name: string; marketCode: string; active: boolean } = schedule ?? {
    name: "",
    marketCode: markets[0] ?? "",
    deliveryWeekday: 4,
    cutoffDays: 2,
    cutoffTime: "23:59",
    active: true,
  };
  const id = schedule?.id ?? "new";
  return (
    <ActionForm action={saveScheduleAction.bind(null, storeSlug, schedule?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
        Name
        <input name="name" required maxLength={80} defaultValue={values.name} placeholder="Thursday delivery" className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Market
        <select name="marketCode" defaultValue={values.marketCode} disabled={schedule !== null} className={control}>
          {markets.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        {schedule && <input type="hidden" name="marketCode" value={values.marketCode} />}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Delivery day
        <select name="deliveryWeekday" defaultValue={values.deliveryWeekday} className={control}>
          {WEEKDAYS.map((weekday) => (
            <option key={weekday} value={weekday}>
              {weekdayName(weekday, "en-GB")}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Cutoff
        <select name="cutoffDays" defaultValue={values.cutoffDays} aria-describedby={`cutoff-help-${id}`} className={control}>
          {[1, 2, 3, 4, 5, 6, 7].map((days) => (
            <option key={days} value={days}>
              {days === 1 ? "1 day before" : `${days} days before`}
              {schedule ? ` (${weekdayName(cutoffWeekday({ deliveryWeekday: values.deliveryWeekday, cutoffDays: days }), "en-GB")})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Cutoff time
        <input name="cutoffTime" type="time" required defaultValue={values.cutoffTime} className={control} />
      </label>
      <p id={`cutoff-help-${id}`} className="text-xs text-muted sm:col-span-2">
        At the cutoff each list becomes that delivery&apos;s order; changes after it go into the next delivery. Shoppers see the
        cutoff with each delivery&apos;s date.
      </p>
      <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={values.active} className="size-4" />
        On: shoppers can choose it, and its lists are delivered
      </label>
      <div className="sm:col-span-2">
        <SubmitButton>{schedule ? "Save" : "Add delivery day"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
