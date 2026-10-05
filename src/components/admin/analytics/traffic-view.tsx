import Link from "next/link";

import { bandHours, WEEKDAY_LABELS } from "@/lib/analytics-heatmap";
import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatDecimal } from "@/lib/analytics-format";
import type { LandingKind } from "@/lib/analytics-traffic";
import type { GeoReport } from "@/server/analytics-geo-data";
import type { SearchReport } from "@/server/analytics-search-data";
import type { TimeReport } from "@/server/analytics-time-data";
import type { SegmentRow, TrafficReport } from "@/server/analytics-traffic-data";

import { Funnel, Heatmap, HorizontalBars, type BarRow } from "./charts";
import { DataTable, ShareBar, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { dayText } from "./overview-view";
import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";

/**
 * The Traffic page's body (D152, docs/analytics.md): where visitors drop out on the way to a purchase, which devices and countries sell,
 * which pages visitors land on, what shoppers search for (above all, what they searched for and did not find) and when the store sells.
 * Drawn from the report objects and nothing else (no data access, so it can be rendered on fixture data).
 *
 * Honesty: everything that needs visits (the funnel, devices, landing pages, conversion by country) is shown only when visits are counted
 * and says how to turn counting on when they are not; everything that does not (countries and cities from orders, search, the weekday and
 * hour pattern) is shown either way. A figure that cannot be known is a dash with its reason, never a zero.
 */

export type TrafficViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  /** The store's time zone: the hours of the sales pattern and the dates of searches are in it. */
  timeZone: string;
  traffic: TrafficReport;
  geo: GeoReport;
  search: SearchReport;
  time: TimeReport;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

const dash = (why: string) => <span title={why}>{NO_FIGURE}</span>;

const oneDecimal = (n: number) => formatDecimal(n, 1);

export const FULL_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** An hour of the day as a one-hour window: 14 is "14:00–15:00". */
export const hourText = (hour: number): string => `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;

/** What a counted visit is, for a figure that needs visit counting and cannot have one: the reason in a sentence. */
export function countingReason(traffic: Pick<TrafficReport, "counting" | "coverage">): string {
  if (!traffic.counting) return "Visit counting is off.";
  if (traffic.coverage.firstDay === null) return "No visit has been counted yet.";
  return "No day of this period has counted visits.";
}

/** A search's last day, in the store's time zone: "3 Oct 2026". */
export function lastSeenText(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return NO_FIGURE;
  try {
    return dayText(new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(ms)));
  } catch {
    return dayText(new Date(ms).toISOString().slice(0, 10));
  }
}

// ---- devices ----

/** Mobile is "a large part" of the visitors from this share of them. */
export const MOBILE_SHARE_LARGE = 0.5;
/** Mobile converts "much lower" when it is at most this share of desktop's conversion. */
export const MOBILE_GAP_RATIO = 0.6;
/** Fewer visits or orders than this and a conversion rate says too little to raise a finger about. */
export const MIN_DEVICE_SESSIONS = 100;
export const MIN_DESKTOP_ORDERS = 5;

/** A device's share of the visits that had a known device (mobile, tablet and desktop); null when there are none. */
export function deviceShare(rows: readonly SegmentRow[], key: string): number | null {
  const known = rows.filter((r) => r.key !== "unknown" && r.sessions !== null);
  const total = known.reduce((s, r) => s + (r.sessions ?? 0), 0);
  const row = known.find((r) => r.key === key);
  return total > 0 && row ? (row.sessions ?? 0) / total : null;
}

/**
 * A plain-words warning when most visitors come on a phone but buy far less than on a computer. Only with enough visits and orders on
 * both sides to mean something; otherwise nothing is said (no verdict from small numbers).
 */
export function mobileCallout(rows: readonly SegmentRow[]): string | null {
  const mobile = rows.find((r) => r.key === "mobile");
  const desktop = rows.find((r) => r.key === "desktop");
  if (!mobile || !desktop || mobile.sessions === null || desktop.sessions === null) return null;
  if (mobile.sessions < MIN_DEVICE_SESSIONS || desktop.sessions < MIN_DEVICE_SESSIONS || desktop.orders < MIN_DESKTOP_ORDERS) return null;
  const share = deviceShare(rows, "mobile");
  if (share === null || share < MOBILE_SHARE_LARGE) return null;
  if (mobile.conversion === null || desktop.conversion === null || desktop.conversion <= 0) return null;
  if (mobile.conversion > desktop.conversion * MOBILE_GAP_RATIO) return null;
  const how =
    mobile.conversion === 0
      ? "and none of them bought"
      : `and they buy at ${formatPercent(mobile.conversion)} while desktop visitors buy at ${formatPercent(desktop.conversion)}, about ${oneDecimal(desktop.conversion / mobile.conversion)} times as often`;
  return `${formatPercent(share, 0)} of your visitors use a phone, ${how}. Open your store on a phone and try to buy something: slow pages, small buttons and a hard checkout are the usual causes.`;
}

// ---- countries ----

export type CountryRow = {
  key: string;
  name: string;
  /** Null on a row that has only visits (the country chooser): there were no orders to count against it. */
  orders: number | null;
  revenueMinor: number | null;
  shareOfRevenue: number | null;
  aovMinor: number | null;
  newCustomers: number | null;
  sessions: number | null;
  conversion: number | null;
};

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The countries' table: what was sold in each from the orders (always known), with the visits and the conversion of the days with counted
 * visits where there are any. A market with visits and no sale is a row of its own, and so is the country chooser, with visits only.
 */
export function countryRows(geo: GeoReport, traffic: TrafficReport): CountryRow[] {
  const visits = traffic.byMarket;
  const seen = new Set<string>();
  const rows: CountryRow[] = geo.countries.map((c) => {
    const v = visits.find((x) => same(x.key, c.code));
    if (v) seen.add(v.key);
    return {
      key: c.code,
      name: c.name,
      orders: c.orders,
      revenueMinor: c.revenueMinor,
      shareOfRevenue: c.shareOfRevenue,
      aovMinor: c.aovMinor,
      newCustomers: c.newCustomers,
      sessions: v ? v.sessions : null,
      conversion: v ? v.conversion : null,
    };
  });
  for (const v of visits) {
    if (seen.has(v.key) || (v.sessions ?? 0) <= 0) continue;
    const door = v.key === "front_door";
    rows.push({
      key: v.key,
      name: v.label,
      orders: door ? null : v.orders,
      revenueMinor: door ? null : v.revenueMinor,
      shareOfRevenue: null,
      aovMinor: door ? null : v.aov,
      newCustomers: null,
      sessions: v.sessions,
      conversion: door ? null : v.conversion,
    });
  }
  return rows;
}

// ---- landing pages ----

export const KIND_LABEL: Record<LandingKind, string> = { product: "Product page", checkout: "Checkout", cart: "Cart", order: "Order page", other: "Other page" };

/** What to call a landing page: a product by its handle, anything else by its address. */
export function landingLabel(row: { kind: LandingKind; handle: string | null; path: string }): string {
  return row.kind === "product" && row.handle ? row.handle : row.path;
}

// ---- when the store sells ----

/** Fewer paid orders than this and "your best day" is a coin toss: nothing is claimed. */
export const MIN_PATTERN_ORDERS = 20;

/** The sentences under the weekday and hour pattern: the best day and hour, in words, and nothing when the orders are too few. */
export function timeWords(time: TimeReport, money: (minor: number | null | undefined) => string): string[] {
  const orders = time.totals.orders;
  if (orders === 0) return [];
  if (orders < MIN_PATTERN_ORDERS) {
    return [`Only ${formatCount(orders)} paid ${plural(orders, "order", "orders")} in this period: too few to say which day or hour sells best. Pick a longer period.`];
  }
  const lines: string[] = [];
  const day = time.bestWeekday;
  if (day) {
    const name = FULL_WEEKDAYS[day.weekday - 1];
    const days = time.weekdayDays[day.weekday - 1] ?? 0;
    lines.push(`${name} is your best day of the week: ${formatCount(day.orders)} ${plural(day.orders, "order", "orders")}, ${money(day.revenueMinor)}${days > 0 ? `, about ${oneDecimal(day.orders / days)} orders each ${name}` : ""}.`);
  }
  if (time.bestHour) lines.push(`The busiest hour is ${hourText(time.bestHour.hour)}, with ${formatCount(time.bestHour.orders)} ${plural(time.bestHour.orders, "order", "orders")} over the period.`);
  const slot = bandHours(time.heatmap, 2).peakByOrders;
  if (slot) lines.push(`The single busiest slot is ${FULL_WEEKDAYS[slot.weekday - 1]} ${pad(slot.hour)}:00–${pad((slot.hour + 2) % 24)}:00, with ${formatCount(slot.orders)} ${plural(slot.orders, "order", "orders")}.`);
  if (time.bestDay) lines.push(`Your best single day was ${dayText(time.bestDay.day)}: ${money(time.bestDay.revenueMinor)} from ${formatCount(time.bestDay.orders)} ${plural(time.bestDay.orders, "order", "orders")}.`);
  return lines;
}

// ---------------------------------------------------------------------------
// Visit counting
// ---------------------------------------------------------------------------

/** Notes the traffic report writes about visit counting itself; the state box says them better, so they are not repeated beside it. */
const COUNTING_NOTE = /^(Visit counting is off|No visit has been counted yet)/;
/** The funnel's own sentence about a step that was cut down: the funnel draws it beside the step, so it is not said twice. */
const CUT_STEP_NOTE = / is more than .*, so it is shown as /;

function CountingState({ base, traffic }: { base: string; traffic: TrafficReport }) {
  if (traffic.sessions !== null) return null;
  const settings = (
    <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
      Open analytics settings
    </Link>
  );
  if (!traffic.counting) {
    return (
      <Note tone="warning" title="Turn on visit counting to see where visitors come from">
        Right now the store does not count visits, so the funnel, devices, landing pages and conversion rate cannot be shown. Counting uses no cookies and stores no one&apos;s address, so it needs no consent banner. It only counts from the day you switch it on. {settings}
      </Note>
    );
  }
  return (
    <Note title={traffic.coverage.firstDay === null ? "No visit has been counted yet" : "No visits were counted in this period"}>
      {traffic.coverage.firstDay === null
        ? "Counting is on, but no visit has arrived yet. Visits appear here from the first day they are counted. "
        : `Visits have been counted since ${dayText(traffic.coverage.firstDay)}, and none fall in this period. `}
      {settings}
    </Note>
  );
}

function NeedsCounting({ traffic, base, what }: { traffic: TrafficReport; base: string; what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
      <p>{`${what} ${countingReason(traffic)}`}</p>
      {!traffic.counting ? (
        <p className="mt-1">
          <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
            Turn on visit counting
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

const HELP = {
  visits: "A visit is one visitor on one day. Coming back the same day is not counted twice, and visitors who opted out are not counted.",
  conversion: "Conversion rate: paid orders divided by visits. 2 % means 2 of every 100 visits ended in a purchase.",
  productView: "The share of visits that looked at a product page.",
  addToCart: "The share of visits that put something in the cart.",
  cartAbandonment: "Of the visits that made a cart, the share that did not end in a purchase.",
  checkoutAbandonment: "Of the visits that reached checkout, the share that did not buy.",
};

export function funnelCards({ base, traffic }: Pick<TrafficViewProps, "base" | "traffic">): KpiCardProps[] {
  const f = traffic.funnel;
  const why = { text: `This needs visits. ${countingReason(traffic)}`, action: { label: "Open analytics settings", href: `${base}/analytics/settings#visits` } };
  const rate = (label: string, value: number | null, help: string, hint: string, good: "up" | "down"): KpiCardProps =>
    value === null ? { label, value: null, state: "missing", missing: why, help } : { label, value: formatPercent(value), help, hint, good };
  const covered = traffic.coverage.partial && traffic.coverage.days > 0 ? ` Over the ${formatCount(traffic.coverage.days)} days with counted visits.` : "";
  return [
    traffic.sessions === null
      ? { label: "Visits", value: null, state: "missing", missing: why, help: HELP.visits }
      : { label: "Visits", value: formatCount(traffic.sessions), help: HELP.visits, hint: `Visitors on days they were counted.${covered}` },
    rate("Conversion rate", traffic.conversion.rate, HELP.conversion, `${formatCount(traffic.conversion.orders)} paid ${plural(traffic.conversion.orders, "order", "orders")} from ${formatCount(traffic.sessions)} visits.`, "up"),
    rate("Looked at a product", f.productViewRate, HELP.productView, "Of all visits.", "up"),
    rate("Added to cart", f.addToCartRate, HELP.addToCart, "Of all visits.", "up"),
    rate("Left with a full cart", f.cartAbandonment, HELP.cartAbandonment, "Of the carts that were made.", "down"),
    rate("Left at checkout", f.checkoutAbandonment, HELP.checkoutAbandonment, "Of the visits that reached checkout.", "down"),
  ];
}

function FunnelSection({ base, traffic, orders }: { base: string; traffic: TrafficReport; orders: number }) {
  const known = traffic.sessions !== null;
  return (
    <AnalyticsSection
      id="funnel"
      title="From visit to purchase"
      description="Where visitors drop out on the way. Each step is a visitor on a day, so a visitor who comes back the same day counts once."
    >
      {known ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 rounded-lg border border-border bg-background p-4">
              <Funnel
                label="Visits, product views, carts, checkouts and purchases"
                stages={traffic.funnel.stages.map((s) => ({
                  label: s.label,
                  value: s.count,
                  note: s.clamped ? `Counted as ${formatCount(s.raw)}, shown as ${formatCount(s.count)}: a step cannot be bigger than the one before it.` : undefined,
                }))}
                format={formatCount}
                exportId="traffic.funnel"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {funnelCards({ base, traffic }).map((c) => (
                <KpiCard key={c.label} {...c} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <NeedsCounting traffic={traffic} base={base} what="There is no funnel to show yet." />
          {orders > 0 ? <p className="text-sm text-muted">{`Your store did make ${formatCount(orders)} paid ${plural(orders, "order", "orders")} in this period. That comes from your orders, not from visits.`}</p> : null}
        </>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

function DevicesSection({ base, traffic, money }: { base: string; traffic: TrafficReport; money: (minor: number | null | undefined) => string }) {
  const rows = traffic.byDevice;
  const callout = mobileCallout(rows);
  const columns: Column<SegmentRow>[] = [
    { key: "device", label: "Device", cell: (r) => (r.key === "unknown" ? <span title="Paid orders that cannot be tied to a counted visit: the shopper was not counted, or bought on another day than the visit.">Unknown</span> : r.label) },
    { key: "sessions", label: "Visits", align: "right", cell: (r) => (r.sessions === null ? dash("Orders with no visit have no visits to count") : formatCount(r.sessions)) },
    {
      key: "share",
      label: "Share of visits",
      align: "right",
      cell: (r) => {
        const share = deviceShare(rows, r.key);
        return r.key === "unknown" || share === null ? dash("Only phones, tablets and computers are compared") : <ShareBar share={share} text={formatPercent(share, 0)} />;
      },
    },
    { key: "conversion", label: "Conversion rate", align: "right", cell: (r) => (r.conversion === null ? dash("Needs counted visits") : formatPercent(r.conversion)) },
    { key: "aov", label: "Average order", align: "right", cell: (r) => (r.aov === null ? dash("No orders") : money(r.aov)) },
    { key: "orders", label: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
    { key: "revenue", label: "Revenue", align: "right", cell: (r) => money(r.revenueMinor) },
  ];
  return (
    <AnalyticsSection id="devices" title="Phones, tablets and computers" description="What each kind of device brings: visits, how many of them buy and how much they spend. Revenue is without VAT.">
      {rows.length === 0 ? (
        <NeedsCounting traffic={traffic} base={base} what="There are no devices to compare yet." />
      ) : (
        <>
          {callout ? <Note tone="warning" title="Phones sell much less than computers">{callout}</Note> : null}
          <DataTable caption="Devices with visits, share of visits, conversion rate, average order, orders and revenue" columns={columns} rows={rows} rowKey={(r) => r.key} exportId="traffic.devices" exportLeftOut={{ orders: traffic.unconverted, currencies: traffic.missingCurrencies }} />
        </>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Countries and cities
// ---------------------------------------------------------------------------

function GeographySection({ base, geo, traffic, money }: { base: string; geo: GeoReport; traffic: TrafficReport; money: (minor: number | null | undefined) => string }) {
  const rows = countryRows(geo, traffic);
  const visitsKnown = traffic.sessions !== null;
  const noVisits = `Needs counted visits. ${countingReason(traffic)}`;
  const countryColumns: Column<CountryRow>[] = [
    { key: "country", label: "Country", cell: (r) => r.name },
    { key: "orders", label: "Orders", align: "right", cell: (r) => (r.orders === null ? dash("Visitors on the country chooser have not picked a country yet") : formatCount(r.orders)) },
    { key: "revenue", label: "Revenue", align: "right", cell: (r) => (r.revenueMinor === null ? dash("No orders") : money(r.revenueMinor)) },
    { key: "share", label: "Share of revenue", align: "right", cell: (r) => (r.shareOfRevenue === null ? dash("No revenue to share") : <ShareBar share={r.shareOfRevenue} text={formatPercent(r.shareOfRevenue)} />) },
    { key: "aov", label: "Average order", align: "right", cell: (r) => (r.aovMinor === null ? dash("No orders") : money(r.aovMinor)) },
    { key: "new", label: "New customers", align: "right", cell: (r) => (r.newCustomers === null ? dash("Not counted for this row") : formatCount(r.newCustomers)) },
    { key: "sessions", label: "Visits", align: "right", cell: (r) => (r.sessions === null ? dash(noVisits) : formatCount(r.sessions)) },
    { key: "conversion", label: "Conversion rate", align: "right", cell: (r) => (r.conversion === null ? dash(visitsKnown ? "No visits from this country on the counted days" : noVisits) : formatPercent(r.conversion)) },
  ];
  const cityColumns: Column<GeoReport["cities"][number]>[] = [
    { key: "city", label: "City", cell: (c) => <span title={c.city}>{c.city}</span> },
    { key: "country", label: "Country", cell: (c) => c.countryName },
    { key: "orders", label: "Orders", align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: "Revenue", align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "share", label: "Share of revenue", align: "right", cell: (c) => <ShareBar share={c.shareOfRevenue} text={formatPercent(c.shareOfRevenue)} /> },
    { key: "aov", label: "Average order", align: "right", cell: (c) => (c.aovMinor === null ? dash("No orders") : money(c.aovMinor)) },
  ];
  const cell = "px-3 py-1.5 text-right tabular-nums";
  const other = geo.otherCities;
  const none = geo.noAddress;
  const cityFooter =
    geo.cities.length > 0 && (other.orders > 0 || none.orders > 0) ? (
      <>
        {other.orders > 0 ? (
          <tr>
            <td className="px-3 py-1.5 text-left">{`Other cities (${formatCount(other.cities)}${geo.truncated ? "+" : ""})`}</td>
            <td />
            <td className={cell}>{formatCount(other.orders)}</td>
            <td className={cell}>{money(other.revenueMinor)}</td>
            <td />
            <td />
          </tr>
        ) : null}
        {none.orders > 0 ? (
          <tr>
            <td className="px-3 py-1.5 text-left" title="Orders with no delivery address, such as digital products">
              {none.label}
            </td>
            <td />
            <td className={cell}>{formatCount(none.orders)}</td>
            <td className={cell}>{money(none.revenueMinor)}</td>
            <td />
            <td />
          </tr>
        ) : null}
      </>
    ) : undefined;
  return (
    <AnalyticsSection
      id="geography"
      title="Where your customers are"
      description="Countries are where the order was placed, cities where it was delivered. Both come from your orders, so they are shown whether or not visits are counted."
    >
      <DataTable
        caption="Countries with orders, revenue, share of revenue, average order, new customers, visits and conversion rate"
        columns={countryColumns}
        rows={rows}
        rowKey={(r) => r.key}
        empty="No paid orders in this period yet."
        exportId="traffic.countries"
        exportLeftOut={{ orders: geo.unconverted, currencies: geo.missingCurrencies }}
        footer={
          rows.length > 1 && geo.totals.orders > 0 ? (
            <tr>
              <td className="px-3 py-1.5 text-left">All countries</td>
              <td className={cell}>{formatCount(geo.totals.orders)}</td>
              <td className={cell}>{money(geo.totals.revenueMinor)}</td>
              <td />
              <td className={cell}>{geo.totals.aovMinor === null ? NO_FIGURE : money(geo.totals.aovMinor)}</td>
              <td className={cell}>{formatCount(geo.totals.newCustomers)}</td>
              <td className={cell}>{visitsKnown ? formatCount(traffic.sessions) : dash(noVisits)}</td>
              <td className={cell}>{traffic.conversion.rate === null ? dash(noVisits) : formatPercent(traffic.conversion.rate)}</td>
            </tr>
          ) : undefined
        }
      />
      {!visitsKnown ? (
        <p className="text-xs text-muted">
          Visits and conversion rate per country need visit counting.{" "}
          {!traffic.counting ? (
            <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
              Turn it on
            </Link>
          ) : null}
        </p>
      ) : null}
      {geo.cities.length > 0 || none.orders > 0 ? (
        <div className="space-y-2">
          <h3 className="text-base font-semibold">Top cities</h3>
          <DataTable caption="The cities with most revenue, with orders, share of revenue and average order" columns={cityColumns} rows={geo.cities} rowKey={(c) => c.key} footer={cityFooter} empty="No order has a delivery city." exportId="traffic.cities" exportLeftOut={{ orders: geo.unconverted, currencies: geo.missingCurrencies }} />
          {geo.truncated ? <p className="text-xs text-muted">There are very many cities, so the smallest were not read and &quot;Other cities&quot; is a little low.</p> : null}
        </div>
      ) : null}
      {geo.unconverted > 0 ? (
        <Note tone="warning">{`${formatCount(geo.unconverted)} paid ${plural(geo.unconverted, "order", "orders")} in ${geo.missingCurrencies.join(", ") || "another currency"} ${plural(geo.unconverted, "is", "are")} left out because the store has no exchange rate for ${plural(geo.missingCurrencies.length, "it", "them")}, so these figures are lower than they should be.`}</Note>
      ) : null}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Landing pages
// ---------------------------------------------------------------------------

function LandingSection({ base, traffic, money }: { base: string; traffic: TrafficReport; money: (minor: number | null | undefined) => string }) {
  const columns: Column<TrafficReport["landingPages"][number]>[] = [
    { key: "page", label: "Page", cell: (r) => <span title={r.path}>{landingLabel(r)}</span> },
    { key: "kind", label: "Kind", cell: (r) => KIND_LABEL[r.kind] },
    { key: "sessions", label: "Visits", align: "right", cell: (r) => (r.sessions === null ? dash("Needs counted visits") : formatCount(r.sessions)) },
    { key: "orders", label: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
    { key: "conversion", label: "Conversion rate", align: "right", cell: (r) => (r.conversion === null ? dash("Needs counted visits") : formatPercent(r.conversion)) },
    { key: "revenue", label: "Revenue", align: "right", cell: (r) => money(r.revenueMinor) },
  ];
  return (
    <AnalyticsSection id="landing" title="Where visitors arrive" description="The pages visits began on, and the orders those visits led to. A product page that gets visits and no orders is worth a look.">
      {traffic.landingPages.length === 0 ? (
        <NeedsCounting traffic={traffic} base={base} what="There are no landing pages to show yet." />
      ) : (
        <DataTable caption="The pages most visits began on, with visits, orders, conversion rate and revenue" columns={columns} rows={traffic.landingPages} rowKey={(r) => r.path} exportId="traffic.landing" exportLeftOut={{ orders: traffic.unconverted, currencies: traffic.missingCurrencies }} />
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchSection({ search, timeZone }: { search: SearchReport; timeZone: string }) {
  const t = search.totals;
  const none = t.searches === 0;
  const zeroColumns: Column<SearchReport["zeroTerms"][number]>[] = [
    { key: "term", label: "What they searched for", cell: (r) => <span title={r.term}>{r.term === "" ? "(empty search)" : r.term}</span> },
    { key: "searches", label: "Times it found nothing", align: "right", cell: (r) => formatCount(r.searches) },
    { key: "last", label: "Last time", align: "right", cell: (r) => lastSeenText(r.lastSearchedAt, timeZone) },
  ];
  const topColumns: Column<SearchReport["topTerms"][number]>[] = [
    { key: "term", label: "Search", cell: (r) => <span title={r.term}>{r.term === "" ? "(empty search)" : r.term}</span> },
    { key: "searches", label: "Searches", align: "right", cell: (r) => formatCount(r.searches) },
    { key: "results", label: "Results shown", align: "right", cell: (r) => <span title="The usual number of products the search found">{formatCount(r.avgResults)}</span> },
    { key: "zero", label: "Found nothing", align: "right", cell: (r) => formatCount(r.zeroResults) },
    { key: "clicked", label: "Opened a result", align: "right", cell: (r) => formatCount(r.clicked) },
    { key: "ctr", label: "Click-through", align: "right", cell: (r) => (r.clickThrough === null ? dash("No searches") : formatPercent(r.clickThrough)) },
  ];
  const cards: KpiCardProps[] = [
    { label: "Searches", value: formatCount(t.searches), help: "Searches made in your store's own search, on the search page.", hint: `${formatCount(t.distinctTerms)} different ${plural(t.distinctTerms, "search", "searches")}.` },
    t.zeroRate === null
      ? { label: "Found nothing", value: null, state: "missing", missing: { text: "No one searched in this period." }, help: "The share of searches that found no product, by keyword or by meaning." }
      : { label: "Found nothing", value: formatPercent(t.zeroRate), good: "down", help: "The share of searches that found no product, by keyword or by meaning.", hint: `${formatCount(t.zeroResultSearches)} of ${formatCount(t.searches)} searches.` },
    t.clickThrough === null
      ? { label: "Click-through", value: null, state: "missing", missing: { text: "No one searched in this period." }, help: "The share of searches where the shopper opened a result." }
      : {
          label: "Click-through",
          value: formatPercent(t.clickThrough),
          good: "up",
          help: "The share of searches where the shopper opened a result.",
          hint: t.clickThroughOfFound === null ? undefined : `${formatPercent(t.clickThroughOfFound)} of the searches that found something.`,
        },
  ];
  return (
    <AnalyticsSection
      id="search"
      title="What shoppers search for"
      description="What people typed into your store's search. It does not need visit counting, and only the last 90 days are kept."
    >
      {search.clamped ? (
        <Note tone="info" title="Older searches are no longer kept">
          {search.period.days > 0
            ? `Searches are kept for ${formatCount(search.retentionDays)} days, so this shows ${dayText(search.availableFrom)} onwards, not ${dayText(search.requested.from)}.`
            : `Searches are kept for ${formatCount(search.retentionDays)} days and all of this period is older, so there is nothing to show.`}
        </Note>
      ) : null}
      {none ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          {search.period.days === 0 ? "There are no searches to show for this period." : "No one used the store's search in this period."}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Searches that found nothing: products your customers want</h3>
            <p className="max-w-prose text-sm text-muted">
              Each of these is a shopper telling you what they could not find. If you sell it, add the words they used to the product. If you do not, it may be a product worth adding.
            </p>
            {search.zeroTerms.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-4 text-sm text-muted">Every search in this period showed at least one product. Nothing is being missed.</div>
            ) : (
              <>
                <DataTable caption="Searches that found nothing, with how many times and when last" columns={zeroColumns} rows={search.zeroTerms} rowKey={(r) => r.term} exportId="traffic.zero_terms" />
                {search.zeroTermCount > search.zeroTerms.length ? (
                  <p className="text-xs text-muted">{`Showing ${formatCount(search.zeroTerms.length)} of ${formatCount(search.zeroTermCount)} different searches that found nothing.`}</p>
                ) : null}
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {cards.map((c) => (
              <KpiCard key={c.label} {...c} />
            ))}
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Most searched</h3>
            <DataTable caption="The most searched terms with searches, results shown, searches that found nothing and click-through" columns={topColumns} rows={search.topTerms} rowKey={(r) => r.term} exportId="traffic.top_terms" />
          </div>
        </>
      )}
      <Note title="Sales after a search are not tracked">{search.revenueNote}</Note>
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// When the store sells
// ---------------------------------------------------------------------------

function WhenSection({ time, timeZone, money }: { time: TimeReport; timeZone: string; money: (minor: number | null | undefined) => string }) {
  const bands = bandHours(time.heatmap, 2);
  const orders = time.totals.orders;
  const rows = bands.bands.map((band, b) => ({ label: band.label, values: bands.cells.map((day) => day[b].orders) }));
  const words = timeWords(time, money);
  const weekdays: BarRow[] = WEEKDAY_LABELS.map((label, i) => {
    const total = time.heatmap.rowTotals[i];
    const days = time.weekdayDays[i] ?? 0;
    return {
      key: label,
      label: FULL_WEEKDAYS[i],
      value: total.orders,
      valueText: `${formatCount(total.orders)} ${plural(total.orders, "order", "orders")}`,
      detail: days > 0 ? `${oneDecimal(total.orders / days)} a day` : undefined,
    };
  });
  return (
    <AnalyticsSection
      id="when"
      title="When customers buy"
      description={`Paid orders by weekday and time of day, in the store's time zone (${timeZone}). It comes from your orders, so it does not need visit counting.`}
    >
      {words.length > 0 ? (
        <ul className="max-w-prose list-disc space-y-1 pl-5 text-sm">
          {words.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 rounded-lg border border-border bg-background p-4">
          <h3 className="mb-3 text-sm font-semibold">Orders by weekday and time of day</h3>
          <Heatmap label="Paid orders by weekday and two-hour band" columns={[...WEEKDAY_LABELS]} rows={rows} format={formatCount} emptyText="No paid orders in this period yet." exportId="traffic.heatmap" exportLeftOut={{ orders: time.unconverted, currencies: time.missingCurrencies }} />
        </div>
        {orders > 0 ? (
          <div className="min-w-0 rounded-lg border border-border bg-background p-4">
            <h3 className="mb-3 text-sm font-semibold">Orders by weekday</h3>
            <HorizontalBars label="Paid orders for each weekday" rows={weekdays} exportId="traffic.weekdays" exportLeftOut={{ orders: time.unconverted, currencies: time.missingCurrencies }} />
          </div>
        ) : null}
      </div>
      {time.unconverted > 0 ? (
        <Note tone="warning">{`${formatCount(time.unconverted)} paid ${plural(time.unconverted, "order", "orders")} in ${time.missingCurrencies.join(", ") || "another currency"} ${plural(time.unconverted, "is", "are")} left out because the store has no exchange rate for ${plural(time.missingCurrencies.length, "it", "them")}.`}</Note>
      ) : null}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const QUESTIONS: readonly { id: string; question: string }[] = [
  { id: "funnel", question: "Where do visitors drop out before they buy?" },
  { id: "search", question: "What do shoppers look for that they cannot find?" },
  { id: "when", question: "When and where do customers buy?" },
];

export function TrafficView(props: TrafficViewProps) {
  const { base, currency, locale, timeZone, traffic, geo, search, time } = props;
  const money = safeMoney(currency, locale);
  const notes = traffic.notes.filter((n) => n.length > 0 && !CUT_STEP_NOTE.test(n) && !(traffic.sessions === null && COUNTING_NOTE.test(n)));
  const unknown = traffic.byDevice.find((r) => r.key === "unknown");

  return (
    <>
      <nav aria-label="Questions this page answers" className="max-w-3xl rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <p className="font-medium">This page answers three things</p>
        <ol aria-label="The three questions" className="mt-1 list-decimal space-y-0.5 pl-5">
          {QUESTIONS.map((q) => (
            <li key={q.id}>
              <a href={`#${q.id}`} className={linkClass}>
                {q.question}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <CountingState base={base} traffic={traffic} />
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((n) => (
            <Note key={n}>{n}</Note>
          ))}
        </div>
      ) : null}
      <FunnelSection base={base} traffic={traffic} orders={time.totals.orders} />
      <DevicesSection base={base} traffic={traffic} money={money} />
      {unknown && unknown.orders > 0 ? (
        <p className="-mt-4 max-w-prose text-xs text-muted">{`${formatCount(unknown.orders)} paid ${plural(unknown.orders, "order", "orders")} (${money(unknown.revenueMinor)}) cannot be tied to a counted visit, so they are in the Unknown row.`}</p>
      ) : null}
      <GeographySection base={base} geo={geo} traffic={traffic} money={money} />
      <LandingSection base={base} traffic={traffic} money={money} />
      <SearchSection search={search} timeZone={timeZone} />
      <WhenSection time={time} timeZone={timeZone} money={money} />
    </>
  );
}
