import Link from "next/link";

import { bandHours, WEEKDAY_LABELS } from "@/lib/analytics-heatmap";
import { formatCount, formatPercent, NO_FIGURE } from "@/lib/analytics-core";
import { formatDecimal } from "@/lib/analytics-format";
import type { LandingKind } from "@/lib/analytics-traffic";
import type { GeoReport } from "@/server/analytics-geo-data";
import { LOW_CLICK_MIN } from "@/lib/analytics-search";
import type { SearchReport } from "@/server/analytics-search-data";
import type { TimeReport } from "@/server/analytics-time-data";
import type { SegmentRow, TrafficReport } from "@/server/analytics-traffic-data";

import { Funnel, Heatmap, HorizontalBars, type BarRow } from "./charts";
import { DataTable, ShareBar, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { dayText } from "./overview-view";
import { AnalyticsSection, Note } from "./section";
import { safeMoney } from "./subscriptions-view";
import { CARD_CLASS } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { reportsEn, type ReportsMessages } from "@/lib/admin-messages/reports.en";

/** The words of this view (D312 A9), English unless given. */
export type TrafficWords = ReportsMessages["traffic"];
type Money = (minor: number | null | undefined) => string;

/** A sentence's first letter in capitals: a weekday is written small inside a Norwegian sentence. */
const cap = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

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
  /** The words, in the account's language (D312 A9); English unless given. */
  words?: TrafficWords;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

const dash = (why: string) => <span title={why}>{NO_FIGURE}</span>;

const oneDecimal = (n: number) => formatDecimal(n, 1);

export const FULL_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** An hour of the day as a one-hour window: 14 is "14:00–15:00". */
export const hourText = (hour: number): string => `${pad(hour)}:00–${pad((hour + 1) % 24)}:00`;

/** What a counted visit is, for a figure that needs visit counting and cannot have one: the reason in a sentence. */
export function countingReason(traffic: Pick<TrafficReport, "counting" | "coverage">, w: TrafficWords = reportsEn.traffic): string {
  if (!traffic.counting) return w.countingOff;
  if (traffic.coverage.firstDay === null) return w.countingNone;
  return w.countingNoDay;
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
export function mobileCallout(rows: readonly SegmentRow[], w: TrafficWords = reportsEn.traffic): string | null {
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
      ? w.mobileNone
      : fillWords(w.mobileGap, { mobile: formatPercent(mobile.conversion), desktop: formatPercent(desktop.conversion), times: oneDecimal(desktop.conversion / mobile.conversion) });
  return fillWords(w.mobileCallout, { share: formatPercent(share, 0), how });
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
export function countryRows(geo: GeoReport, traffic: TrafficReport, w: TrafficWords = reportsEn.traffic): CountryRow[] {
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
      name: w.devices[v.key] ?? v.label,
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
export function timeWords(time: TimeReport, money: (minor: number | null | undefined) => string, w: TrafficWords = reportsEn.traffic): string[] {
  const ordersOf = (n: number) => countWords(n, w.orders, { n: formatCount(n) });
  const orders = time.totals.orders;
  if (orders === 0) return [];
  if (orders < MIN_PATTERN_ORDERS) {
    return [countWords(orders, w.tooFewOrders, { n: formatCount(orders) })];
  }
  const lines: string[] = [];
  const day = time.bestWeekday;
  if (day) {
    const name = w.weekdays[day.weekday - 1];
    const days = time.weekdayDays[day.weekday - 1] ?? 0;
    const each = days > 0 ? fillWords(w.bestDayEach, { n: oneDecimal(day.orders / days), day: name }) : "";
    lines.push(cap(fillWords(w.bestDay, { day: name, orders: ordersOf(day.orders), amount: money(day.revenueMinor), each })));
  }
  if (time.bestHour) lines.push(fillWords(w.bestHour, { hour: hourText(time.bestHour.hour), orders: ordersOf(time.bestHour.orders) }));
  const slot = bandHours(time.heatmap, 2).peakByOrders;
  if (slot) lines.push(fillWords(w.bestSlot, { day: w.weekdays[slot.weekday - 1], from: pad(slot.hour), to: pad((slot.hour + 2) % 24), orders: ordersOf(slot.orders) }));
  if (time.bestDay) lines.push(fillWords(w.bestSingleDay, { day: dayText(time.bestDay.day), amount: money(time.bestDay.revenueMinor), orders: ordersOf(time.bestDay.orders) }));
  return lines;
}

// ---------------------------------------------------------------------------
// Visit counting
// ---------------------------------------------------------------------------

/** Notes the traffic report writes about visit counting itself; the state box says them better, so they are not repeated beside it. */
const COUNTING_NOTE = /^(Visit counting is off|No visit has been counted yet)/;
/** The funnel's own sentence about a step that was cut down: the funnel draws it beside the step, so it is not said twice. */
const CUT_STEP_NOTE = / is more than .*, so it is shown as /;

function CountingState({ base, traffic, w }: { base: string; traffic: TrafficReport; w: TrafficWords }) {
  if (traffic.sessions !== null) return null;
  const settings = (
    <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
      {w.openSettings}
    </Link>
  );
  if (!traffic.counting) {
    return (
      <Note tone="warning" title={w.turnOnTitle}>
        {w.turnOnText}
        {settings}
      </Note>
    );
  }
  return (
    <Note title={traffic.coverage.firstDay === null ? w.noneYetTitle : w.noneInPeriodTitle}>
      {traffic.coverage.firstDay === null ? w.noneYetText : fillWords(w.noneInPeriodText, { day: dayText(traffic.coverage.firstDay) })}
      {settings}
    </Note>
  );
}

function NeedsCounting({ traffic, base, what, w }: { traffic: TrafficReport; base: string; what: string; w: TrafficWords }) {
  return (
    <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
      <p>{`${what} ${countingReason(traffic, w)}`}</p>
      {!traffic.counting ? (
        <p className="mt-1">
          <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
            {w.turnOn}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------


export function funnelCards({ base, traffic, words: w = reportsEn.traffic }: Pick<TrafficViewProps, "base" | "traffic" | "words">): KpiCardProps[] {
  const f = traffic.funnel;
  const HELP = w.help;
  const why = { text: fillWords(w.needsVisits, { reason: countingReason(traffic, w) }), action: { label: w.openSettings, href: `${base}/analytics/settings#visits` } };
  const rate = (label: string, value: number | null, help: string, hint: string, good: "up" | "down"): KpiCardProps =>
    value === null ? { label, value: null, state: "missing", missing: why, help } : { label, value: formatPercent(value), help, hint, good };
  const covered = traffic.coverage.partial && traffic.coverage.days > 0 ? fillWords(w.coveredDays, { n: formatCount(traffic.coverage.days) }) : "";
  return [
    traffic.sessions === null
      ? { label: w.visits, value: null, state: "missing", missing: why, help: HELP.visits }
      : { label: w.visits, value: formatCount(traffic.sessions), help: HELP.visits, hint: fillWords(w.visitsHint, { covered }) },
    rate(
      w.conversionRate,
      traffic.conversion.rate,
      HELP.conversion,
      countWords(traffic.conversion.orders, w.conversionHint, { n: formatCount(traffic.conversion.orders), visits: formatCount(traffic.sessions) }),
      "up",
    ),
    rate(w.lookedAtProduct, f.productViewRate, HELP.productView, w.ofAllVisits, "up"),
    rate(w.addedToCart, f.addToCartRate, HELP.addToCart, w.ofAllVisits, "up"),
    rate(w.leftWithCart, f.cartAbandonment, HELP.cartAbandonment, w.ofCarts, "down"),
    rate(w.leftAtCheckout, f.checkoutAbandonment, HELP.checkoutAbandonment, w.ofCheckouts, "down"),
  ];
}

function FunnelSection({ base, traffic, orders, w }: { base: string; traffic: TrafficReport; orders: number; w: TrafficWords }) {
  const known = traffic.sessions !== null;
  return (
    <AnalyticsSection
      id="funnel"
      title={w.funnelTitle}
      description={w.funnelDescription}
    >
      {known ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className={`min-w-0 p-4 ${CARD_CLASS}`}>
              <Funnel
                label={w.funnelLabel}
                stages={traffic.funnel.stages.map((s) => ({
                  label: w.stages[s.key] ?? s.label,
                  value: s.count,
                  note: s.clamped ? fillWords(w.clamped, { raw: formatCount(s.raw), count: formatCount(s.count) }) : undefined,
                }))}
                format={formatCount}
                exportId="traffic.funnel"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {funnelCards({ base, traffic, words: w }).map((c) => (
                <KpiCard key={c.label} {...c} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <NeedsCounting traffic={traffic} base={base} what={w.noFunnel} w={w} />
          {orders > 0 ? <p className="text-sm text-muted">{countWords(orders, w.ordersAnyway, { n: formatCount(orders) })}</p> : null}
        </>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

function DevicesSection({ base, traffic, money, w }: { base: string; traffic: TrafficReport; money: Money; w: TrafficWords }) {
  const rows = traffic.byDevice;
  const callout = mobileCallout(rows, w);
  const l = w.columns;
  const why = w.why;
  const columns: Column<SegmentRow>[] = [
    { key: "device", label: l.device, cell: (r) => (r.key === "unknown" ? <span title={w.deviceUnknownWhy}>{w.devices.unknown}</span> : (w.devices[r.key] ?? r.label)) },
    { key: "sessions", label: l.visits, align: "right", cell: (r) => (r.sessions === null ? dash(why.noVisitsToCount) : formatCount(r.sessions)) },
    {
      key: "share",
      label: l.shareOfVisits,
      align: "right",
      cell: (r) => {
        const share = deviceShare(rows, r.key);
        return r.key === "unknown" || share === null ? dash(why.onlyDevices) : <ShareBar share={share} text={formatPercent(share, 0)} />;
      },
    },
    { key: "conversion", label: l.conversion, align: "right", cell: (r) => (r.conversion === null ? dash(why.needsVisits) : formatPercent(r.conversion)) },
    { key: "aov", label: l.aov, align: "right", cell: (r) => (r.aov === null ? dash(why.noOrders) : money(r.aov)) },
    { key: "orders", label: l.orders, align: "right", cell: (r) => formatCount(r.orders) },
    { key: "revenue", label: l.revenue, align: "right", cell: (r) => money(r.revenueMinor) },
  ];
  return (
    <AnalyticsSection id="devices" title={w.devicesTitle} description={w.devicesDescription}>
      {rows.length === 0 ? (
        <NeedsCounting traffic={traffic} base={base} what={w.noDevices} w={w} />
      ) : (
        <>
          {callout ? <Note tone="warning" title={w.mobileTitle}>{callout}</Note> : null}
          <DataTable caption={w.devicesCaption} columns={columns} rows={rows} rowKey={(r) => r.key} exportId="traffic.devices" exportLeftOut={{ orders: traffic.unconverted, currencies: traffic.missingCurrencies }} />
        </>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Countries and cities
// ---------------------------------------------------------------------------

function GeographySection({ base, geo, traffic, money, w }: { base: string; geo: GeoReport; traffic: TrafficReport; money: Money; w: TrafficWords }) {
  const rows = countryRows(geo, traffic, w);
  const visitsKnown = traffic.sessions !== null;
  const l = w.columns;
  const why = w.why;
  const noVisits = fillWords(w.needsVisitsReason, { reason: countingReason(traffic, w) });
  const countryColumns: Column<CountryRow>[] = [
    { key: "country", label: l.country, cell: (r) => r.name },
    { key: "orders", label: l.orders, align: "right", cell: (r) => (r.orders === null ? dash(why.chooser) : formatCount(r.orders)) },
    { key: "revenue", label: l.revenue, align: "right", cell: (r) => (r.revenueMinor === null ? dash(why.noOrders) : money(r.revenueMinor)) },
    { key: "share", label: l.shareOfRevenue, align: "right", cell: (r) => (r.shareOfRevenue === null ? dash(why.noRevenue) : <ShareBar share={r.shareOfRevenue} text={formatPercent(r.shareOfRevenue)} />) },
    { key: "aov", label: l.aov, align: "right", cell: (r) => (r.aovMinor === null ? dash(why.noOrders) : money(r.aovMinor)) },
    { key: "new", label: l.newCustomers, align: "right", cell: (r) => (r.newCustomers === null ? dash(why.notCounted) : formatCount(r.newCustomers)) },
    { key: "sessions", label: l.visits, align: "right", cell: (r) => (r.sessions === null ? dash(noVisits) : formatCount(r.sessions)) },
    { key: "conversion", label: l.conversion, align: "right", cell: (r) => (r.conversion === null ? dash(visitsKnown ? why.noCountryVisits : noVisits) : formatPercent(r.conversion)) },
  ];
  const cityColumns: Column<GeoReport["cities"][number]>[] = [
    { key: "city", label: l.city, cell: (c) => <span title={c.city}>{c.city}</span> },
    { key: "country", label: l.country, cell: (c) => c.countryName },
    { key: "orders", label: l.orders, align: "right", cell: (c) => formatCount(c.orders) },
    { key: "revenue", label: l.revenue, align: "right", cell: (c) => money(c.revenueMinor) },
    { key: "share", label: l.shareOfRevenue, align: "right", cell: (c) => <ShareBar share={c.shareOfRevenue} text={formatPercent(c.shareOfRevenue)} /> },
    { key: "aov", label: l.aov, align: "right", cell: (c) => (c.aovMinor === null ? dash(why.noOrders) : money(c.aovMinor)) },
  ];
  const cell = "px-3 py-1.5 text-right tabular-nums";
  const other = geo.otherCities;
  const none = geo.noAddress;
  const cityFooter =
    geo.cities.length > 0 && (other.orders > 0 || none.orders > 0) ? (
      <>
        {other.orders > 0 ? (
          <tr>
            <td className="px-3 py-1.5 text-left">{fillWords(w.otherCities, { n: formatCount(other.cities), more: geo.truncated ? "+" : "" })}</td>
            <td />
            <td className={cell}>{formatCount(other.orders)}</td>
            <td className={cell}>{money(other.revenueMinor)}</td>
            <td />
            <td />
          </tr>
        ) : null}
        {none.orders > 0 ? (
          <tr>
            <td className="px-3 py-1.5 text-left" title={why.noAddress}>
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
      title={w.geoTitle}
      description={w.geoDescription}
    >
      <DataTable
        caption={w.countriesCaption}
        columns={countryColumns}
        rows={rows}
        rowKey={(r) => r.key}
        empty={w.noOrdersYet}
        exportId="traffic.countries"
        exportLeftOut={{ orders: geo.unconverted, currencies: geo.missingCurrencies }}
        footer={
          rows.length > 1 && geo.totals.orders > 0 ? (
            <tr>
              <td className="px-3 py-1.5 text-left">{w.allCountries}</td>
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
          {w.countryVisitsNeedCounting}{" "}
          {!traffic.counting ? (
            <Link href={`${base}/analytics/settings#visits`} className={linkClass}>
              {w.turnItOn}
            </Link>
          ) : null}
        </p>
      ) : null}
      {geo.cities.length > 0 || none.orders > 0 ? (
        <div className="space-y-2">
          <h3 className="text-body-strong text-ink">{w.topCities}</h3>
          <DataTable caption={w.citiesCaption} columns={cityColumns} rows={geo.cities} rowKey={(c) => c.key} footer={cityFooter} empty={w.noCity} exportId="traffic.cities" exportLeftOut={{ orders: geo.unconverted, currencies: geo.missingCurrencies }} />
          {geo.truncated ? <p className="text-xs text-muted">{w.citiesTruncated}</p> : null}
        </div>
      ) : null}
      {geo.unconverted > 0 ? (
        <Note tone="warning">
          {countWords(geo.unconverted, w.leftOut, {
            n: formatCount(geo.unconverted),
            currencies: geo.missingCurrencies.join(", ") || w.anotherCurrency,
            them: geo.missingCurrencies.length === 1 ? w.it : w.them,
          })}
        </Note>
      ) : null}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Landing pages
// ---------------------------------------------------------------------------

function LandingSection({ base, traffic, money, w }: { base: string; traffic: TrafficReport; money: Money; w: TrafficWords }) {
  const l = w.columns;
  const columns: Column<TrafficReport["landingPages"][number]>[] = [
    { key: "page", label: l.page, cell: (r) => <span title={r.path}>{landingLabel(r)}</span> },
    { key: "kind", label: l.kind, cell: (r) => w.kinds[r.kind] ?? KIND_LABEL[r.kind] },
    { key: "sessions", label: l.visits, align: "right", cell: (r) => (r.sessions === null ? dash(w.why.needsVisits) : formatCount(r.sessions)) },
    { key: "orders", label: l.orders, align: "right", cell: (r) => formatCount(r.orders) },
    { key: "conversion", label: l.conversion, align: "right", cell: (r) => (r.conversion === null ? dash(w.why.needsVisits) : formatPercent(r.conversion)) },
    { key: "revenue", label: l.revenue, align: "right", cell: (r) => money(r.revenueMinor) },
  ];
  return (
    <AnalyticsSection id="landing" title={w.landingTitle} description={w.landingDescription}>
      {traffic.landingPages.length === 0 ? (
        <NeedsCounting traffic={traffic} base={base} what={w.noLanding} w={w} />
      ) : (
        <DataTable caption={w.landingCaption} columns={columns} rows={traffic.landingPages} rowKey={(r) => r.path} exportId="traffic.landing" exportLeftOut={{ orders: traffic.unconverted, currencies: traffic.missingCurrencies }} />
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchSection({ base, search, timeZone, money, w }: { base: string; search: SearchReport; timeZone: string; money: Money; w: TrafficWords }) {
  const t = search.totals;
  const none = t.searches === 0;
  const l = w.columns;
  const term = (value: string) => <span title={value}>{value === "" ? w.emptySearch : value}</span>;
  const zeroColumns: Column<SearchReport["zeroTerms"][number]>[] = [
    { key: "term", label: l.searched, cell: (r) => term(r.term) },
    { key: "searches", label: l.timesNothing, align: "right", cell: (r) => formatCount(r.searches) },
    { key: "last", label: l.lastTime, align: "right", cell: (r) => lastSeenText(r.lastSearchedAt, timeZone) },
  ];
  const topColumns: Column<SearchReport["topTerms"][number]>[] = [
    { key: "term", label: l.search, cell: (r) => term(r.term) },
    { key: "searches", label: l.searches, align: "right", cell: (r) => formatCount(r.searches) },
    { key: "results", label: l.resultsShown, align: "right", cell: (r) => <span title={w.why.usualResults}>{formatCount(r.avgResults)}</span> },
    { key: "zero", label: l.foundNothing, align: "right", cell: (r) => formatCount(r.zeroResults) },
    { key: "clicked", label: l.openedResult, align: "right", cell: (r) => formatCount(r.clicked) },
    { key: "ctr", label: l.clickThrough, align: "right", cell: (r) => (r.clickThrough === null ? dash(w.why.noSearches) : formatPercent(r.clickThrough)) },
    // What the term's searches led to (D347), only where a search of the period was tied to a visit.
    ...(search.afterSearch ? [{ key: "orders", label: l.ordersAfter, align: "right" as const, cell: (r: SearchReport["topTerms"][number]) => formatCount(r.orders ?? 0) }] : []),
  ];
  const lowColumns: Column<SearchReport["lowClickTerms"][number]>[] = [
    { key: "term", label: l.search, cell: (r) => term(r.term) },
    { key: "searches", label: l.searches, align: "right", cell: (r) => formatCount(r.searches) },
    { key: "results", label: l.resultsShown, align: "right", cell: (r) => formatCount(r.avgResults) },
    { key: "ctr", label: l.clickThrough, align: "right", cell: (r) => (r.clickThrough === null ? dash(w.why.noSearches) : formatPercent(r.clickThrough)) },
    {
      key: "fix",
      label: w.fixColumn,
      cell: (r) => (
        <span className="flex flex-wrap gap-3">
          <Link href={`${base}/search?synonym=${encodeURIComponent(r.term)}#synonyms`} className={linkClass}>
            {w.addSynonym}
          </Link>
          <Link href={`${base}/search#rules`} className={linkClass}>
            {w.pinProduct}
          </Link>
        </span>
      ),
    },
  ];
  const after = search.afterSearch;
  const afterCards: KpiCardProps[] = after
    ? [
        { label: w.afterTied, value: formatCount(after.tiedSearches), help: w.afterTiedHelp, hint: fillWords(w.afterTiedHint, { tied: formatCount(after.tiedSearches), n: formatCount(t.searches) }) },
        { label: w.afterConversion, value: after.conversion === null ? NO_FIGURE : formatPercent(after.conversion), good: "up", help: w.afterConversionHelp },
        { label: w.afterOrders, value: formatCount(after.orders), help: w.afterOrdersHelp },
        {
          label: w.afterRevenue,
          value: money(after.revenueMinor),
          help: w.afterRevenueHelp,
          hint: after.unconverted > 0 ? countWords(after.unconverted, w.afterUnconverted, { n: formatCount(after.unconverted), currencies: after.missingCurrencies.join(", ") }) : undefined,
        },
      ]
    : [];
  const dayColumns: Column<SearchReport["byDay"][number]>[] = [
    { key: "day", label: l.day, cell: (r) => dayText(r.day) },
    { key: "tied", label: l.tied, align: "right", cell: (r) => formatCount(r.tied) },
    { key: "converted", label: l.converted, align: "right", cell: (r) => formatCount(r.converted) },
    { key: "rate", label: l.rate, align: "right", cell: (r) => (r.tied > 0 ? formatPercent(r.converted / r.tied) : NO_FIGURE) },
  ];
  const cards: KpiCardProps[] = [
    { label: w.searchesLabel, value: formatCount(t.searches), help: w.searchesHelp, hint: countWords(t.distinctTerms, w.searchesHint, { n: formatCount(t.distinctTerms) }) },
    t.zeroRate === null
      ? { label: w.foundNothing, value: null, state: "missing", missing: { text: w.noOneSearched }, help: w.foundNothingHelp }
      : {
          label: w.foundNothing,
          value: formatPercent(t.zeroRate),
          good: "down",
          help: w.foundNothingHelp,
          hint: fillWords(w.foundNothingHint, { zero: formatCount(t.zeroResultSearches), n: formatCount(t.searches) }),
        },
    t.clickThrough === null
      ? { label: w.clickThrough, value: null, state: "missing", missing: { text: w.noOneSearched }, help: w.clickThroughHelp }
      : {
          label: w.clickThrough,
          value: formatPercent(t.clickThrough),
          good: "up",
          help: w.clickThroughHelp,
          hint: t.clickThroughOfFound === null ? undefined : fillWords(w.clickThroughFound, { pct: formatPercent(t.clickThroughOfFound) }),
        },
  ];
  return (
    <AnalyticsSection id="search" title={w.searchTitle} description={w.searchDescription}>
      {search.clamped ? (
        <Note tone="info" title={w.olderTitle}>
          {search.period.days > 0
            ? fillWords(w.olderSome, { days: formatCount(search.retentionDays), from: dayText(search.availableFrom), requested: dayText(search.requested.from) })
            : fillWords(w.olderAll, { days: formatCount(search.retentionDays) })}
        </Note>
      ) : null}
      {none ? (
        <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
          {search.period.days === 0 ? w.noSearchesPeriod : w.noSearchUsed}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <h3 className="text-body-strong text-ink">{w.zeroTitle}</h3>
            <p className="max-w-prose text-sm text-muted">{w.zeroText}</p>
            {search.zeroTerms.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line px-4 py-4 text-sm text-muted">{w.nothingMissed}</div>
            ) : (
              <>
                <DataTable caption={w.zeroCaption} columns={zeroColumns} rows={search.zeroTerms} rowKey={(r) => r.term} exportId="traffic.zero_terms" />
                {search.zeroTermCount > search.zeroTerms.length ? (
                  <p className="text-xs text-muted">{fillWords(w.zeroShowing, { shown: formatCount(search.zeroTerms.length), total: formatCount(search.zeroTermCount) })}</p>
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
            <h3 className="text-body-strong text-ink">{w.mostSearched}</h3>
            <DataTable caption={w.topCaption} columns={topColumns} rows={search.topTerms} rowKey={(r) => r.term} exportId="traffic.top_terms" />
          </div>
          {search.lowClickTerms.length > 0 ? (
            <div className="space-y-2" data-low-click>
              <h3 className="text-body-strong text-ink">{w.lowClickTitle}</h3>
              <p className="max-w-prose text-sm text-muted">{fillWords(w.lowClickText, { min: formatCount(LOW_CLICK_MIN) })}</p>
              <DataTable caption={w.lowClickCaption} columns={lowColumns} rows={search.lowClickTerms} rowKey={(r) => r.term} exportId="traffic.low_click_terms" />
            </div>
          ) : null}
        </>
      )}
      {after ? (
        <div className="space-y-3" data-after-search>
          <h3 className="text-body-strong text-ink">{w.afterTitle}</h3>
          <p className="max-w-prose text-sm text-muted">{w.afterText}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {afterCards.map((c) => (
              <KpiCard key={c.label} {...c} />
            ))}
          </div>
          {search.byDay.length > 0 ? (
            <>
              <h3 className="text-body-strong text-ink">{w.byDayTitle}</h3>
              <DataTable caption={w.byDayCaption} columns={dayColumns} rows={search.byDay} rowKey={(r) => r.day} exportId="traffic.search_days" />
            </>
          ) : null}
        </div>
      ) : (
        <Note title={w.noSalesTracked}>{w.afterOff}</Note>
      )}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// When the store sells
// ---------------------------------------------------------------------------

function WhenSection({ time, timeZone, money, w }: { time: TimeReport; timeZone: string; money: Money; w: TrafficWords }) {
  const bands = bandHours(time.heatmap, 2);
  const orders = time.totals.orders;
  const rows = bands.bands.map((band, b) => ({ label: band.label, values: bands.cells.map((day) => day[b].orders) }));
  const words = timeWords(time, money, w);
  const weekdays: BarRow[] = WEEKDAY_LABELS.map((label, i) => {
    const total = time.heatmap.rowTotals[i];
    const days = time.weekdayDays[i] ?? 0;
    return {
      key: label,
      label: cap(w.weekdays[i]),
      value: total.orders,
      valueText: countWords(total.orders, w.orders, { n: formatCount(total.orders) }),
      detail: days > 0 ? fillWords(w.aDay, { n: oneDecimal(total.orders / days) }) : undefined,
    };
  });
  return (
    <AnalyticsSection
      id="when"
      title={w.whenTitle}
      description={fillWords(w.whenDescription, { zone: timeZone })}
    >
      {words.length > 0 ? (
        <ul className="max-w-prose list-disc space-y-1 pl-5 text-sm">
          {words.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className={`min-w-0 p-4 ${CARD_CLASS}`}>
          <h3 className="mb-3 text-body-strong text-ink">{w.heatmapTitle}</h3>
          <Heatmap label={w.heatmapLabel} columns={w.weekdaysShort.length === 7 ? [...w.weekdaysShort] : [...WEEKDAY_LABELS]} rows={rows} format={formatCount} emptyText={w.noOrdersYet} exportId="traffic.heatmap" exportLeftOut={{ orders: time.unconverted, currencies: time.missingCurrencies }} />
        </div>
        {orders > 0 ? (
          <div className={`min-w-0 p-4 ${CARD_CLASS}`}>
            <h3 className="mb-3 text-body-strong text-ink">{w.weekdayTitle}</h3>
            <HorizontalBars label={w.weekdayLabel} rows={weekdays} exportId="traffic.weekdays" exportLeftOut={{ orders: time.unconverted, currencies: time.missingCurrencies }} />
          </div>
        ) : null}
      </div>
      {time.unconverted > 0 ? (
        <Note tone="warning">
          {countWords(time.unconverted, w.leftOutShort, {
            n: formatCount(time.unconverted),
            currencies: time.missingCurrencies.join(", ") || w.anotherCurrency,
            them: time.missingCurrencies.length === 1 ? w.it : w.them,
          })}
        </Note>
      ) : null}
    </AnalyticsSection>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const QUESTION_IDS = ["funnel", "search", "when"] as const;

export function TrafficView(props: TrafficViewProps) {
  const { base, currency, locale, timeZone, traffic, geo, search, time } = props;
  const w = props.words ?? reportsEn.traffic;
  const money = safeMoney(currency, locale);
  const notes = traffic.notes.filter((n) => n.length > 0 && !CUT_STEP_NOTE.test(n) && !(traffic.sessions === null && COUNTING_NOTE.test(n)));
  const unknown = traffic.byDevice.find((r) => r.key === "unknown");

  return (
    <>
      <nav aria-label={w.questionsLabel} className="max-w-3xl rounded-panel bg-sunken px-4 py-3 text-sm">
        <p className="font-medium">{w.questionsTitle}</p>
        <ol aria-label={w.questionsList} className="mt-1 list-decimal space-y-0.5 pl-5">
          {QUESTION_IDS.map((id) => (
            <li key={id}>
              <a href={`#${id}`} className={linkClass}>
                {w.questions[id]}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <CountingState base={base} traffic={traffic} w={w} />
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((n) => (
            <Note key={n}>{n}</Note>
          ))}
        </div>
      ) : null}
      <FunnelSection base={base} traffic={traffic} orders={time.totals.orders} w={w} />
      <DevicesSection base={base} traffic={traffic} money={money} w={w} />
      {unknown && unknown.orders > 0 ? (
        <p className="-mt-4 max-w-prose text-xs text-muted">{countWords(unknown.orders, w.unknownOrders, { n: formatCount(unknown.orders), amount: money(unknown.revenueMinor) })}</p>
      ) : null}
      <GeographySection base={base} geo={geo} traffic={traffic} money={money} w={w} />
      <LandingSection base={base} traffic={traffic} money={money} w={w} />
      <SearchSection base={base} search={search} timeZone={timeZone} money={money} w={w} />
      <WhenSection time={time} timeZone={timeZone} money={money} w={w} />
    </>
  );
}
