import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatMoney } from "@/lib/money";
import { cutoffWeekday, formatCutoff, formatDeliveryDate, WEEKDAYS, weekdayName, type DeliverySchedule } from "@/lib/standing-orders";
import { memberCan, requirePermission } from "@/server/permissions";
import { deliveryRounds, listStandingOrders, type ScheduleView } from "@/server/standing-orders";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";

import { saveScheduleAction } from "./actions";

export const metadata: Metadata = { title: "Subscription boxes" };

const card = "rounded-lg border border-line bg-card p-5";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";


/**
 * Weekly deliveries (D102): the store's delivery days, each round's orders
 * (made at its cutoff, charged when sent), and the shoppers' lists.
 */
export default async function DeliveriesPage({ params }: PageProps<"/admin/[store]/deliveries">) {
  const current = await requirePermission((await params).store, "orders:read");
  const off = requireFeature(current, "boxes");
  if (off) return off;
  const { store } = current;
  const owner = memberCan(current, "owner");
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "bookings").boxes;
  const LIST_STATUS: Record<string, string> = w.listStatus;
  const ORDER_STATUS: Record<string, string> = w.orderStatus;
  const dayLocale = lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale;
  const [rounds, lists] = await Promise.all([deliveryRounds(store.id), listStandingOrders(store.id)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const when = (at: number) => formatCutoff(at, locale, store.timeZone);
  const day = (date: string) => formatDeliveryDate(date, locale);
  const currencyOf = (schedule: ScheduleView) => schedule.currency;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={fillWords(w.description, { zone: store.timeZone.replace("_", " ") })}
      />

      {rounds.map(({ schedule, current, next }) => (
        <section key={schedule.id} aria-label={schedule.name} className={card}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-title text-ink">
              {schedule.name} <span className="font-normal text-muted">· {schedule.marketCode}</span>
              {!schedule.active && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs text-muted">{w.off}</span>}
            </h2>
            <p className="text-sm text-muted">
              {countWords(schedule.lists, w.lists)} · {fillWords(w.nextCutoff, { when: when(next.cutoffAt), day: day(next.date) })}
            </p>
          </div>
          {current ? (
            <>
              <h3 className="mb-2 text-body-strong text-ink">
                {day(current.date)}: {countWords(current.orders.length, w.orders)}
                {current.skipped > 0 && <span className="font-normal text-muted"> · {fillWords(w.skipped, { n: current.skipped })}</span>}
              </h3>
              {current.orders.length === 0 ? (
                <p className="text-sm text-muted">{w.noOrders}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        <th scope="col" className="py-2 pr-4 font-medium">{w.order}</th>
                        <th scope="col" className="py-2 pr-4 font-medium">{w.customer}</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">{w.items}</th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">{w.total}</th>
                        <th scope="col" className="py-2 font-medium">{w.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.orders.map((order) => (
                        <tr key={order.orderId} className="border-b border-line last:border-0">
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
            <p className="text-sm text-muted">{w.nothingPacked}</p>
          )}
          {owner && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm underline">{w.change}</summary>
              <div className="mt-3">
                <ScheduleForm words={w.form} dayLocale={dayLocale} storeSlug={store.slug} schedule={schedule} markets={store.markets.map((m) => m.code)} />
              </div>
            </details>
          )}
        </section>
      ))}

      {owner && (
        <section aria-labelledby="add-day" className={card}>
          <h2 id="add-day" className="mb-1 text-title text-ink">
            {rounds.length === 0 ? w.addFirst : w.add}
          </h2>
          <p className="mb-4 text-sm text-muted">{w.addHint}</p>
          <ScheduleForm words={w.form} dayLocale={dayLocale} storeSlug={store.slug} schedule={null} markets={store.markets.map((m) => m.code)} />
        </section>
      )}

      <section aria-labelledby="lists" className={card}>
        <h2 id="lists" className="mb-3 text-title text-ink">
          {w.listsTitle}
        </h2>
        {lists.length === 0 ? (
          <p className="text-sm text-muted">{w.noLists}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 pr-4 font-medium">{w.customer}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{w.day}</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">{w.items}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{w.card}</th>
                  <th scope="col" className="py-2 font-medium">{w.status}</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/${store.slug}/customers/${list.customerId}`} className="underline">
                        {list.name || list.email}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{list.schedule}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {list.items} <span className="text-muted">({countWords(list.lines, w.kinds)})</span>
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
  words: w,
  dayLocale,
}: {
  words: BookingsMessages["boxes"]["form"];
  dayLocale: string;
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
        {w.name}
        <input name="name" required maxLength={80} defaultValue={values.name} placeholder={w.namePlaceholder} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.market}
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
        {w.day}
        <select name="deliveryWeekday" defaultValue={values.deliveryWeekday} className={control}>
          {WEEKDAYS.map((weekday) => (
            <option key={weekday} value={weekday}>
              {weekdayName(weekday, dayLocale)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.cutoff}
        <select name="cutoffDays" defaultValue={values.cutoffDays} aria-describedby={`cutoff-help-${id}`} className={control}>
          {[1, 2, 3, 4, 5, 6, 7].map((days) => (
            <option key={days} value={days}>
              {countWords(days, w.daysBefore)}
              {schedule ? ` (${weekdayName(cutoffWeekday({ deliveryWeekday: values.deliveryWeekday, cutoffDays: days }), dayLocale)})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.cutoffTime}
        <input name="cutoffTime" type="time" required defaultValue={values.cutoffTime} className={control} />
      </label>
      <p id={`cutoff-help-${id}`} className="text-xs text-muted sm:col-span-2">
        {w.cutoffHint}
      </p>
      <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
        <input type="checkbox" name="active" defaultChecked={values.active} className="size-4" />
        {w.on}
      </label>
      <div className="sm:col-span-2">
        <SubmitButton>{schedule ? w.save : w.add}</SubmitButton>
      </div>
    </ActionForm>
  );
}
