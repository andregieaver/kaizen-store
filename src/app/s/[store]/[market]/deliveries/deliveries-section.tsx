import Link from "next/link";

import { VatAmount } from "@/components/price";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import type { StoreQuery } from "@/lib/store-parts";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { WITH_VAT } from "@/lib/pricing";
import { cutoffFor, cutoffWeekday, formatCutoff, formatDeliveryDate, weekdayName } from "@/lib/standing-orders";
import { getCustomer } from "@/server/customers";
import { getShopperOrder } from "@/server/orders";
import type { Store } from "@/server/stores";
import {
  deliveryOrderForSession,
  finishCardSetup,
  getStandingOrder,
  listSchedules,
  type DeliveryOrder,
} from "@/server/standing-orders";

import {
  deliveryAddressAction,
  deliveryStatusAction,
  payDeliveryAction,
  setDeliveryQuantityAction,
  skipDeliveryAction,
  startDeliveryAction,
} from "./actions";
import { ConfirmButton, DeliveryAddressForm, DeliverySetupForm, type AddressValues } from "./delivery-forms";

const card = "flex flex-col gap-4 rounded-lg border border-border p-5";
const small = "min-h-11 rounded-button border border-border px-3 text-sm hover:bg-surface";

/**
 * The shopper's weekly delivery (D102): the list, the next delivery, and how
 * it is charged. The deliveries page shows it, and so does a store's own page
 * for it (D113); both check first that the store offers them and that the
 * market is in its country's own currency.
 */
export function DeliveriesSection(props: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <Deliveries {...props} />
    </div>
  );
}

async function Deliveries({ store, market, query: asked }: { store: Store; market: Market; query: Promise<StoreQuery> }) {
  const m = t(market.lang);
  const d = m.deliveries;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);

  const heading = (
    <div className="flex flex-col gap-2">
      <h1 className="text-3xl font-heading tracking-tight">{d.title}</h1>
      <p className="text-muted">{d.intro}</p>
    </div>
  );
  if (!customer) {
    return (
      <>
        {heading}
        <p>
          {d.signIn}{" "}
          <Link href={`${base}/account`} className="underline">
            {d.signInLink}
          </Link>
        </p>
      </>
    );
  }

  // Back from Stripe: a card saved, or a delivery paid.
  const query = await asked;
  let notice: string | null = null;
  if (typeof query.setup === "string" && query.setup.startsWith("cs_")) {
    if (await finishCardSetup(store.id, customer.id, query.setup)) notice = d.cardSaved;
  }
  if (typeof query.paid === "string" && query.paid.startsWith("cs_")) {
    const orderId = await deliveryOrderForSession(store.id, customer.id, query.paid);
    const order = orderId ? await getShopperOrder(store.id, orderId, query.paid) : null;
    if (order && order.status !== "pending_payment") notice = d.paid;
  }

  const [list, schedules] = await Promise.all([
    getStandingOrder(store.id, customer.id, market),
    listSchedules(store.id, { activeOnly: true, marketCode: market.code }),
  ]);
  const scheduleLabel = (s: (typeof schedules)[number]) =>
    d.scheduleOption(weekdayName(s.deliveryWeekday, market.locale), `${weekdayName(cutoffWeekday(s), market.locale)} ${s.cutoffTime}`);
  const addressOf = (a: Partial<Record<keyof AddressValues, string | null | undefined>>): AddressValues => ({
    name: a.name ?? customer.name,
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    postalCode: a.postalCode ?? "",
    city: a.city ?? "",
    phone: a.phone ?? customer.phone,
  });
  const addressLabels = { name: d.name, line1: d.line1, line2: d.line2, postalCode: d.postalCode, city: d.city, phone: d.phone };
  const setup = (chosen: string | null, address: AddressValues, submit: string) => (
    <DeliverySetupForm
      action={startDeliveryAction.bind(null, store.slug, market.slug)}
      schedules={schedules.map((s) => ({ id: s.id, label: scheduleLabel(s) }))}
      chosen={chosen}
      address={address}
      labels={{
        ...addressLabels,
        deliveryDay: d.deliveryDay,
        address: d.address,
        consent: d.consent,
        submit,
        saving: d.saving,
        problems: d.problems,
      }}
    />
  );
  const noticeLine = notice && (
    <p role="status" className="rounded-lg bg-accent px-4 py-3 text-accent-foreground">
      {notice}
    </p>
  );

  if (!list || list.status === "setup") {
    return (
      <>
        {heading}
        {noticeLine}
        {list && <p className="text-muted">{d.settingUp}</p>}
        {schedules.length === 0 ? (
          <p>{d.noSchedule}</p>
        ) : (
          <section aria-labelledby="setup-heading" className={card}>
            <h2 id="setup-heading" className="text-xl font-heading">
              {d.setUpHeading}
            </h2>
            {setup(list?.schedule.id ?? null, addressOf(list?.shippingAddress ?? customer.address), d.saveCard)}
          </section>
        )}
      </>
    );
  }

  const money = (minor: number) => formatMoney(minor, list.currency, market.locale);
  const vatLabels = { vatIncluded: m.vatIncluded, vatExcluded: m.vatExcluded };
  // The total mixes VAT rates: it is shown as charged, with VAT.
  const withVat = WITH_VAT;
  const deliveryDay = (date: string) => formatDeliveryDate(date, market.locale);
  const act = (bound: () => Promise<void>, label: string, extra = "") => (
    <form action={bound}>
      <button type="submit" className={`${small} ${extra}`}>
        {label}
      </button>
    </form>
  );
  const packed = (delivery: DeliveryOrder, headingText: string) => (
    <section aria-label={headingText} className={card}>
      <h2 className="text-xl font-heading">{headingText}</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {delivery.lines.map((line) => (
          <li key={line.title} className="flex justify-between gap-4">
            <span>
              {line.quantity} × {line.title}
            </span>
            <span className="tabular-nums">{money(line.totalMinor)}</span>
          </li>
        ))}
        {delivery.shippingMinor > 0 && (
          <li className="flex justify-between gap-4 text-muted">
            <span>{d.shipping}</span>
            <span className="tabular-nums">{money(delivery.shippingMinor)}</span>
          </li>
        )}
      </ul>
      {delivery.leftOut.length > 0 && (
        <p className="text-sm text-muted">
          {d.leftOut}: {delivery.leftOut.map((l) => d.leftOutLine(l.title, l.wanted, l.got)).join(", ")}
        </p>
      )}
      {delivery.payFailed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert">{d.payNeeded}</p>
          <form action={payDeliveryAction.bind(null, store.slug, market.slug, delivery.orderId)}>
            <button type="submit" className="min-h-11 button-primary px-5 text-sm font-medium">
              {d.payNow} · {money(delivery.totalMinor)}
            </button>
          </form>
        </div>
      ) : (
        delivery.status === "pending_payment" && <p className="text-sm">{d.packingNote(money(delivery.totalMinor))}</p>
      )}
    </section>
  );

  return (
    <>
      {heading}
      {noticeLine}
      {list.status === "paused" && (
        <p role="status" className="rounded-lg border border-border px-4 py-3">
          {d.paused}
        </p>
      )}
      {list.unpaid.map((delivery) => (
        <div key={delivery.orderId}>{packed(delivery, d.packing(deliveryDay(delivery.date)))}</div>
      ))}
      {list.current && packed(list.current, d.packing(deliveryDay(list.current.date)))}

      <section aria-labelledby="list-heading" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="list-heading" className="text-xl font-heading">
            {d.listHeading}
          </h2>
          {list.status === "active" && (
            <p className="text-sm text-muted">
              {d.next(deliveryDay(list.next.date))}. {d.changeUntil(formatCutoff(list.next.cutoffAt, market.locale, store.timeZone))}
            </p>
          )}
        </div>
        {list.lines.length === 0 ? (
          <p className="text-muted">{d.emptyList}</p>
        ) : (
          <ul className="divide-y divide-border">
            {list.lines.map((line) => (
              <li key={line.variantId} className="flex flex-wrap items-center gap-3 py-3">
                {line.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the store's own small picture
                  <img src={line.image} alt="" className="size-12 rounded-md bg-surface object-cover" />
                ) : (
                  <span className="size-12 rounded-md bg-surface" />
                )}
                <div className="min-w-40 flex-1">
                  <Link href={`${base}/p/${line.productHandle}`} className="hover:underline">
                    {line.title}
                  </Link>
                  <p className="text-sm text-muted">
                    {line.available && line.unitMinor !== null ? (
                      <VatAmount amountMinor={line.unitMinor} currency={list.currency} locale={market.locale} vat={line.vat} labels={vatLabels} />
                    ) : (
                      d.unavailable
                    )}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1">
                  {act(setDeliveryQuantityAction.bind(null, store.slug, market.slug, line.variantId, line.quantity - 1), "−", "w-11 px-0")}
                  <span className="w-8 text-center tabular-nums" aria-label={`${line.quantity}`}>
                    {line.quantity}
                  </span>
                  {act(setDeliveryQuantityAction.bind(null, store.slug, market.slug, line.variantId, line.quantity + 1), "+", "w-11 px-0")}
                  <form action={setDeliveryQuantityAction.bind(null, store.slug, market.slug, line.variantId, 0)}>
                    <button type="submit" className="min-h-11 px-2 text-sm underline" aria-label={d.remove(line.title)}>
                      ×
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.estimate.itemsMinor > 0 && (
          <dl className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
            <p className="text-muted">{d.estimate}</p>
            <div className="flex justify-between">
              <dt>{d.items}</dt>
              <dd className="tabular-nums">{money(list.estimate.itemsMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{d.shipping}</dt>
              <dd className="tabular-nums">{money(list.estimate.shippingMinor)}</dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>{d.total}</dt>
              <dd className="tabular-nums">
                <VatAmount amountMinor={list.estimate.totalMinor} currency={list.currency} locale={market.locale} vat={withVat} labels={vatLabels} />
              </dd>
            </div>
          </dl>
        )}
      </section>

      {list.status === "active" && (
        <section aria-labelledby="skip-heading" className={card}>
          <h2 id="skip-heading" className="text-xl font-heading">
            {d.skipHeading}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {list.upcoming.map((date) => {
              const skipped = list.skipDates.includes(date);
              return (
                <li key={date} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {deliveryDay(date)}
                    <span className="block text-sm text-muted">
                      {skipped ? d.skipped : d.changeUntil(formatCutoff(cutoffFor(list.schedule, date, store.timeZone), market.locale, store.timeZone))}
                    </span>
                  </span>
                  {act(skipDeliveryAction.bind(null, store.slug, market.slug, date, !skipped), skipped ? d.unskip : d.skip)}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="address-heading" className={card}>
        <h2 id="address-heading" className="text-xl font-heading">
          {d.address}
        </h2>
        <DeliveryAddressForm
          action={deliveryAddressAction.bind(null, store.slug, market.slug)}
          address={addressOf(list.shippingAddress)}
          labels={{ ...addressLabels, save: d.saveAddress, saving: d.saving, saved: d.addressSaved, tryAgain: d.tryAgain }}
        />
      </section>

      <section aria-labelledby="card-heading" className={card}>
        <h2 id="card-heading" className="text-xl font-heading">
          {d.card}
        </h2>
        <p>
          {list.cardLabel} · {list.schedule.name}
        </p>
        <details>
          <summary className="cursor-pointer text-sm underline">{d.changeDay}</summary>
          <div className="pt-4">{setup(list.schedule.id, addressOf(list.shippingAddress), d.changeCard)}</div>
        </details>
      </section>

      <div className="flex flex-wrap gap-2">
        {list.status === "active"
          ? act(deliveryStatusAction.bind(null, store.slug, market.slug, "pause"), d.pause)
          : act(deliveryStatusAction.bind(null, store.slug, market.slug, "resume"), d.resume)}
        <ConfirmButton action={deliveryStatusAction.bind(null, store.slug, market.slug, "cancel")} label={d.cancel} question={d.cancelConfirm} />
      </div>

      {list.history.length > 0 && (
        <section aria-labelledby="history-heading" className="flex flex-col gap-2">
          <h2 id="history-heading" className="text-xl font-heading">
            {d.history}
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.history.map((entry) => (
              <li key={entry.date} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <span>
                  {deliveryDay(entry.date)}
                  <span className="block text-muted">
                    {entry.number ? `${d.outcome.ordered} ${entry.number}` : (d.outcome as Record<string, string>)[entry.outcome]}
                  </span>
                </span>
                {entry.totalMinor !== null && (
                  <span className="text-right">
                    <span className="block tabular-nums">{money(entry.totalMinor)}</span>
                    <span className="block text-muted">{entry.status ? (m.account.status[entry.status] ?? entry.status) : ""}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
