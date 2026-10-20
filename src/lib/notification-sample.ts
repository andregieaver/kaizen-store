/**
 * The made-up order the notification editor's preview and test email use (wave 3, D238, `docs/wave-3-notifications.md` 2.1 points 3 and 4). Pure: it
 * names no real customer, product or price of the store; amounts are whole minor units in the market's own currency, the lines add up to the total
 * (arithmetic in code, never stated by hand), and the words are plain English placeholders for products ("Sample product") so a preview cannot be
 * mistaken for a real order. The server draws it with the same builders as a real email (`previewNotification()`).
 */
import { formatMoney, minorUnitDigits } from "./money";
import type { PlaceholderValues } from "./email-template";
import { dayWords, termsDueOn } from "./payment-terms";

export type SampleLine = { title: string; quantity: number; unitMinor: number; totalMinor: number };

export type SampleOrder = {
  number: string;
  currency: string;
  locale: string;
  lang: string;
  customerFirstName: string;
  lines: SampleLine[];
  subtotalMinor: number;
  shippingMinor: number;
  totalMinor: number;
  /** The part refunded in the refund preview: the first line. */
  refundMinor: number;
  parcel: { carrier: string; trackingNumber: string };
  returnNumber: string;
  changeNumber: string;
  pickupPlace: string;
  placedAt: string;
  /** The day an order on 30 days' terms (D293) placed then would be due. */
  dueOn: string;
};

/** Whole units of the currency, so the sample reads as a price in it (100 NOK, 100 EUR, 10 000 HUF are all ordinary). */
const unit = (currency: string, units: number) => units * 10 ** minorUnitDigits(currency);

/** The sample order for a store in a market and language. `now` is passed in so a test is stable. */
export function sampleOrder(input: { storeName: string; currency: string; locale: string; lang: string; now?: Date }): SampleOrder {
  const lines: SampleLine[] = [
    { title: "Sample product", quantity: 2, unitMinor: unit(input.currency, 149), totalMinor: 0 },
    { title: "Another sample product", quantity: 1, unitMinor: unit(input.currency, 299), totalMinor: 0 },
  ].map((l) => ({ ...l, totalMinor: l.unitMinor * l.quantity }));
  const subtotalMinor = lines.reduce((sum, l) => sum + l.totalMinor, 0);
  const shippingMinor = unit(input.currency, 49);
  return {
    number: "1001",
    currency: input.currency,
    locale: input.locale,
    lang: input.lang,
    customerFirstName: "Kari",
    lines,
    subtotalMinor,
    shippingMinor,
    totalMinor: subtotalMinor + shippingMinor,
    refundMinor: lines[0].totalMinor,
    parcel: { carrier: "Posten / Bring", trackingNumber: "370000000000000000" },
    returnNumber: "R-1001-1",
    changeNumber: "E1",
    pickupPlace: input.storeName,
    placedAt: (input.now ?? new Date()).toISOString(),
    dueOn: termsDueOn((input.now ?? new Date()).toISOString().slice(0, 10), "net_30"),
  };
}

/** The sample's placeholder values, as a real email would fill them (money in the sample's own currency and locale). */
export function samplePlaceholders(sample: SampleOrder, storeName: string): Required<PlaceholderValues> {
  const money = (minor: number) => formatMoney(minor, sample.currency, sample.locale);
  return {
    store_name: storeName,
    order_number: sample.number,
    customer_first_name: sample.customerFirstName,
    order_total: money(sample.totalMinor),
    carrier: sample.parcel.carrier,
    tracking_number: sample.parcel.trackingNumber,
    refund_amount: money(sample.refundMinor),
    return_number: sample.returnNumber,
    pickup_place: sample.pickupPlace,
    change_number: sample.changeNumber,
    due_date: dayWords(sample.dueOn, sample.locale),
  };
}
