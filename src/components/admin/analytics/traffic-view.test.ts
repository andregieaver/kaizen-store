import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { buildHeatmap, type HeatmapRow } from "@/lib/analytics-heatmap";
import { funnel } from "@/lib/analytics-traffic";
import type { GeoReport } from "@/server/analytics-geo-data";
import type { SearchReport } from "@/server/analytics-search-data";
import type { TimeReport } from "@/server/analytics-time-data";
import type { SegmentRow, TrafficReport } from "@/server/analytics-traffic-data";

import { safeMoney } from "./subscriptions-view";
import {
  countingReason,
  countryRows,
  deviceShare,
  funnelCards,
  hourText,
  landingLabel,
  lastSeenText,
  mobileCallout,
  MIN_PATTERN_ORDERS,
  timeWords,
  TrafficView,
  type TrafficViewProps,
} from "./traffic-view";

/** What a person reads: comment markers gone, entities and no-break spaces made plain. */
const text = (props: TrafficViewProps) =>
  renderToString(h(TrafficView, props))
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

/** The words that must never reach a page: a figure that went wrong. */
const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;

const write = safeMoney("NOK", "nb-NO");

// ---------- fixtures ----------

const PERIOD = { from: "2026-09-03", to: "2026-10-03", days: 30 };

const seg = (key: string, label: string, sessions: number | null, orders: number, revenueMinor: number): SegmentRow => ({
  key,
  label,
  sessions,
  orders,
  revenueMinor,
  conversion: sessions && sessions > 0 ? orders / sessions : null,
  aov: orders > 0 ? Math.round(revenueMinor / orders) : null,
});

const coverage = (over: Partial<TrafficReport["coverage"]> = {}): TrafficReport["coverage"] => ({
  counting: true,
  firstDay: "2026-08-01",
  partial: false,
  from: "2026-09-03",
  to: "2026-10-03",
  days: 30,
  ...over,
});

/** A store that does not count visits (or has none yet): every visit figure is null, as `trafficReport()` gives it. */
function noVisits(over: Partial<TrafficReport> = {}): TrafficReport {
  return {
    currency: "NOK",
    counting: false,
    coverage: { counting: false, firstDay: null, partial: false, from: null, to: null, days: 0 },
    sessions: null,
    funnel: funnel({ sessions: null, productViewers: null, carts: null, checkouts: null, purchases: null }),
    conversion: { orders: 0, sessions: null, rate: null },
    byDevice: [],
    byMarket: [],
    landingPages: [],
    landingTruncated: false,
    unknownOrders: { orders: 0, revenueMinor: 0 },
    staffOrders: { orders: 0, revenueMinor: 0 },
    uncoveredOrders: { orders: 0, revenueMinor: 0 },
    unconverted: 0,
    missingCurrencies: [],
    notes: ["Visit counting is off, so visits, the funnel and where orders came from are not known. Switch it on in the analytics settings."],
    ...over,
  };
}

/** A store with counted visits: 3000 visits, most on phones, converting badly there. */
function normalTraffic(over: Partial<TrafficReport> = {}): TrafficReport {
  const counts = { sessions: 3000, productViewers: 1800, carts: 420, checkouts: 210, purchases: 90 };
  return {
    currency: "NOK",
    counting: true,
    coverage: coverage(),
    sessions: 3000,
    funnel: funnel(counts),
    conversion: { orders: 90, sessions: 3000, rate: 0.03 },
    byDevice: [seg("mobile", "Mobile", 1800, 18, 1_800_000), seg("tablet", "Tablet", 200, 4, 450_000), seg("desktop", "Desktop", 1000, 60, 7_200_000), seg("unknown", "Unknown", null, 8, 900_000)],
    byMarket: [seg("NO", "Norway", 2400, 70, 8_000_000), seg("SE", "Sweden", 500, 12, 1_300_000), seg("DK", "Denmark", 60, 0, 0), seg("front_door", "Front door (country chooser)", 40, 0, 0)],
    landingPages: [
      { ...seg("/s/shop/no/p/wool-sweater", "/s/shop/no/p/wool-sweater", 900, 30, 3_600_000), path: "/s/shop/no/p/wool-sweater", kind: "product", handle: "wool-sweater" },
      { ...seg("/s/shop/no", "/s/shop/no", 700, 12, 1_400_000), path: "/s/shop/no", kind: "other", handle: null },
    ],
    landingTruncated: false,
    unknownOrders: { orders: 8, revenueMinor: 900_000 },
    staffOrders: { orders: 0, revenueMinor: 0 },
    uncoveredOrders: { orders: 0, revenueMinor: 0 },
    unconverted: 0,
    missingCurrencies: [],
    notes: [],
    ...over,
  };
}

function emptyGeo(over: Partial<GeoReport> = {}): GeoReport {
  return {
    currency: "NOK",
    period: PERIOD,
    totals: { orders: 0, revenueMinor: 0, aovMinor: null, newCustomers: 0 },
    countries: [],
    cities: [],
    otherCities: { cities: 0, orders: 0, revenueMinor: 0 },
    noAddress: { label: "No address", orders: 0, revenueMinor: 0, shareOfRevenue: null },
    unconverted: 0,
    missingCurrencies: [],
    truncated: false,
    ...over,
  };
}

function normalGeo(over: Partial<GeoReport> = {}): GeoReport {
  return emptyGeo({
    totals: { orders: 90, revenueMinor: 9_900_000, aovMinor: 110_000, newCustomers: 50 },
    countries: [
      { code: "NO", name: "Norway", orders: 76, revenueMinor: 8_500_000, aovMinor: 111_842, newCustomers: 40, shareOfRevenue: 0.858, sessions: null, conversion: null },
      { code: "SE", name: "Sweden", orders: 14, revenueMinor: 1_400_000, aovMinor: 100_000, newCustomers: 10, shareOfRevenue: 0.142, sessions: null, conversion: null },
    ],
    cities: [
      { key: "NO|oslo", city: "Oslo", country: "NO", countryName: "Norway", orders: 30, revenueMinor: 3_500_000, aovMinor: 116_667, shareOfRevenue: 0.35 },
      { key: "NO|bergen", city: "Bergen", country: "NO", countryName: "Norway", orders: 12, revenueMinor: 1_300_000, aovMinor: 108_333, shareOfRevenue: 0.13 },
    ],
    otherCities: { cities: 9, orders: 40, revenueMinor: 4_500_000 },
    noAddress: { label: "No address", orders: 8, revenueMinor: 600_000, shareOfRevenue: 0.06 },
    ...over,
  });
}

function emptySearch(over: Partial<SearchReport> = {}): SearchReport {
  return {
    requested: PERIOD,
    period: PERIOD,
    clamped: false,
    retentionDays: 90,
    availableFrom: "2026-07-05",
    totals: { searches: 0, distinctTerms: 0, zeroResultSearches: 0, zeroRate: null, clickedSearches: 0, clickThrough: null, clickThroughOfFound: null },
    topTerms: [],
    zeroTerms: [],
    zeroTermCount: 0,
    revenueTracked: false,
    revenueNote: "Revenue after a search is not tracked: a search is not tied to a visit or an order.",
    ...over,
  };
}

function normalSearch(over: Partial<SearchReport> = {}): SearchReport {
  return emptySearch({
    totals: { searches: 400, distinctTerms: 120, zeroResultSearches: 60, zeroRate: 0.15, clickedSearches: 180, clickThrough: 0.45, clickThroughOfFound: 0.53 },
    topTerms: [
      { term: "wool sweater", searches: 80, avgResults: 6, zeroResults: 0, clicked: 50, clickThrough: 0.625 },
      { term: "gift card", searches: 40, avgResults: 0, zeroResults: 40, clicked: 0, clickThrough: 0 },
      { term: "<script>alert(1)</script>", searches: 3, avgResults: 0, zeroResults: 3, clicked: 0, clickThrough: 0 },
    ],
    zeroTerms: [
      { term: "gift card", searches: 40, lastSearchedAt: "2026-10-01T22:30:00.000Z" },
      { term: "<script>alert(1)</script>", searches: 3, lastSearchedAt: "2026-09-12T08:00:00.000Z" },
    ],
    zeroTermCount: 25,
    ...over,
  });
}

/** The time report the way `timeReport()` builds it from the heatmap's rows. */
function timeOf(rows: HeatmapRow[], over: Partial<TimeReport> = {}): TimeReport {
  const heatmap = buildHeatmap(rows);
  const bestRow = heatmap.peakWeekday === null ? null : heatmap.rowTotals[heatmap.peakWeekday - 1];
  const bestCol = heatmap.peakHour === null ? null : heatmap.colTotals[heatmap.peakHour];
  const orders = heatmap.total.orders;
  const revenue = heatmap.total.revenueMinor;
  return {
    currency: "NOK",
    period: PERIOD,
    rows,
    heatmap,
    weekdayDays: [4, 4, 4, 5, 5, 4, 4],
    bestWeekday: bestRow && heatmap.peakWeekday !== null ? { weekday: heatmap.peakWeekday, orders: bestRow.orders, revenueMinor: bestRow.revenueMinor } : null,
    bestHour: bestCol && heatmap.peakHour !== null ? { hour: heatmap.peakHour, orders: bestCol.orders, revenueMinor: bestCol.revenueMinor } : null,
    bestDay: orders > 0 ? { day: "2026-09-25", weekday: 5, orders: 9, revenueMinor: 1_100_000 } : null,
    daily: [],
    totals: { orders, revenueMinor: revenue, aovMinor: orders > 0 ? Math.round(revenue / orders) : null },
    unconverted: 0,
    missingCurrencies: [],
    ...over,
  };
}

const NORMAL_ROWS: HeatmapRow[] = [
  { weekday: 1, hour: 9, orders: 4, revenueMinor: 400_000 },
  { weekday: 2, hour: 11, orders: 6, revenueMinor: 650_000 },
  { weekday: 5, hour: 14, orders: 22, revenueMinor: 2_500_000 },
  { weekday: 5, hour: 15, orders: 14, revenueMinor: 1_500_000 },
  { weekday: 6, hour: 20, orders: 10, revenueMinor: 1_100_000 },
  { weekday: 7, hour: 21, orders: 8, revenueMinor: 900_000 },
  { weekday: 3, hour: 13, orders: 26, revenueMinor: 2_850_000 },
];

const props = (over: Partial<TrafficViewProps> = {}): TrafficViewProps => ({
  base: "/admin/shop",
  currency: "NOK",
  locale: "nb-NO",
  timeZone: "Europe/Oslo",
  traffic: normalTraffic(),
  geo: normalGeo(),
  search: normalSearch(),
  time: timeOf(NORMAL_ROWS),
  ...over,
});

/** A store with nothing at all: no visit counting, no orders, no searches. */
const emptyProps = (): TrafficViewProps => props({ traffic: noVisits(), geo: emptyGeo(), search: emptySearch(), time: timeOf([]) });

// ---------- helpers ----------

describe("helpers", () => {
  it("says why a figure that needs visits is missing", () => {
    expect(countingReason(noVisits())).toBe("Visit counting is off.");
    expect(countingReason(noVisits({ counting: true, coverage: coverage({ firstDay: null, from: null, to: null, days: 0 }) }))).toBe("No visit has been counted yet.");
    expect(countingReason(noVisits({ counting: true, coverage: coverage({ from: null, to: null, days: 0 }) }))).toBe("No day of this period has counted visits.");
  });

  it("writes an hour as a one-hour window and wraps midnight", () => {
    expect(hourText(14)).toBe("14:00–15:00");
    expect(hourText(9)).toBe("09:00–10:00");
    expect(hourText(23)).toBe("23:00–00:00");
  });

  it("writes a search's last day in the store's time zone", () => {
    // 22:30 UTC is already the next day in Oslo.
    expect(lastSeenText("2026-10-01T22:30:00.000Z", "Europe/Oslo")).toMatch(/^2 Oct/);
    expect(lastSeenText("2026-10-01T22:30:00.000Z", "UTC")).toMatch(/^1 Oct/);
    expect(lastSeenText("not a date", "UTC")).toBe("–");
    expect(lastSeenText("2026-10-01T22:30:00.000Z", "Not/AZone")).toMatch(/^1 Oct/);
  });

  it("names a product landing page by its handle and every other by its address", () => {
    expect(landingLabel({ kind: "product", handle: "wool-sweater", path: "/s/shop/no/p/wool-sweater" })).toBe("wool-sweater");
    expect(landingLabel({ kind: "cart", handle: null, path: "/s/shop/no/cart" })).toBe("/s/shop/no/cart");
  });
});

describe("mobileCallout", () => {
  const rows = (mobile: SegmentRow, desktop: SegmentRow, tablet = seg("tablet", "Tablet", 100, 2, 200_000)) => [mobile, tablet, desktop, seg("unknown", "Unknown", null, 3, 300_000)];

  it("speaks up when most visitors use a phone and buy far less than on a computer", () => {
    const words = mobileCallout(normalTraffic().byDevice);
    expect(words).toContain("60 % of your visitors use a phone");
    expect(words).toContain("1.0 %");
    expect(words).toContain("6.0 %");
    expect(words).toContain("about 6.0 times as often");
    expect(words).toContain("try to buy something");
  });

  it("says none bought when phones sold nothing", () => {
    const words = mobileCallout(rows(seg("mobile", "Mobile", 1500, 0, 0), seg("desktop", "Desktop", 1000, 40, 4_000_000)));
    expect(words).toContain("none of them bought");
    expect(words).not.toMatch(BAD);
  });

  it("stays quiet when phones are a small share of the visitors", () => {
    expect(mobileCallout(rows(seg("mobile", "Mobile", 400, 2, 200_000), seg("desktop", "Desktop", 1000, 40, 4_000_000)))).toBeNull();
  });

  it("stays quiet when phones convert about as well as computers", () => {
    expect(mobileCallout(rows(seg("mobile", "Mobile", 1800, 40, 4_000_000), seg("desktop", "Desktop", 1000, 30, 3_000_000)))).toBeNull();
  });

  it("stays quiet when the numbers are small", () => {
    expect(mobileCallout(rows(seg("mobile", "Mobile", 90, 0, 0), seg("desktop", "Desktop", 50, 4, 400_000)))).toBeNull();
    expect(mobileCallout(rows(seg("mobile", "Mobile", 1800, 1, 100_000), seg("desktop", "Desktop", 1000, 4, 400_000)))).toBeNull();
  });

  it("stays quiet when visits are not known", () => {
    expect(mobileCallout([])).toBeNull();
    expect(mobileCallout(rows(seg("mobile", "Mobile", null, 5, 500_000), seg("desktop", "Desktop", 1000, 40, 4_000_000)))).toBeNull();
  });

  it("works out a device's share from the devices it can compare, not from unknown orders", () => {
    expect(deviceShare(normalTraffic().byDevice, "mobile")).toBeCloseTo(0.6, 5);
    expect(deviceShare(normalTraffic().byDevice, "unknown")).toBeNull();
    expect(deviceShare([], "mobile")).toBeNull();
  });
});

describe("countryRows", () => {
  const rows = countryRows(normalGeo(), normalTraffic());

  it("puts what sold first, with the visits of the same country beside it", () => {
    expect(rows.map((r) => r.name).slice(0, 2)).toEqual(["Norway", "Sweden"]);
    expect(rows[0].sessions).toBe(2400);
    expect(rows[0].conversion).toBeCloseTo(70 / 2400, 6);
    expect(rows[0].orders).toBe(76);
  });

  it("adds a market that has visits and no sale, and the country chooser, with visits only", () => {
    const denmark = rows.find((r) => r.key === "DK")!;
    expect(denmark.orders).toBe(0);
    expect(denmark.sessions).toBe(60);
    const door = rows.find((r) => r.key === "front_door")!;
    expect(door.orders).toBeNull();
    expect(door.revenueMinor).toBeNull();
    expect(door.conversion).toBeNull();
    expect(door.sessions).toBe(40);
  });

  it("has no visits for a country when visits are not counted, and never a zero", () => {
    const without = countryRows(normalGeo(), noVisits());
    expect(without).toHaveLength(2);
    for (const r of without) {
      expect(r.sessions).toBeNull();
      expect(r.conversion).toBeNull();
    }
  });

  it("matches a country code whatever its case", () => {
    const lower = normalTraffic({ byMarket: [seg("no", "Norway", 1000, 20, 2_000_000)] });
    expect(countryRows(normalGeo(), lower)[0].sessions).toBe(1000);
  });
});

describe("timeWords", () => {
  it("says nothing when there are no orders (the chart says that)", () => {
    expect(timeWords(timeOf([]), write)).toEqual([]);
  });

  it("claims no best day or hour from too few orders", () => {
    const few = timeOf([{ weekday: 2, hour: 10, orders: MIN_PATTERN_ORDERS - 1, revenueMinor: 100_000 }]);
    const words = timeWords(few, write);
    expect(words).toHaveLength(1);
    expect(words[0]).toContain("too few to say");
    expect(words[0]).toContain(`${MIN_PATTERN_ORDERS - 1} paid orders`);
  });

  it("names the best weekday, hour, slot and day with their figures", () => {
    const words = timeWords(timeOf(NORMAL_ROWS), write);
    expect(words).toHaveLength(4);
    expect(words[0]).toMatch(/^Friday is your best day of the week: 36 orders/);
    expect(words[0]).toContain("about 7.2 orders each Friday");
    expect(words[1]).toBe("The busiest hour is 13:00–14:00, with 26 orders over the period.");
    expect(words[2]).toBe("The single busiest slot is Friday 14:00–16:00, with 36 orders.");
    expect(words[3]).toContain("Your best single day was");
    expect(words[3]).toContain("9 orders");
  });

  it("does not divide by a weekday the period does not hold", () => {
    const words = timeWords(timeOf(NORMAL_ROWS, { weekdayDays: [0, 0, 0, 0, 0, 0, 0] }), write);
    expect(words[0]).not.toContain("each Friday");
    expect(words.join(" ")).not.toMatch(BAD);
  });
});

describe("funnelCards", () => {
  it("has every rate when visits are counted", () => {
    const cards = funnelCards({ base: "/admin/shop", traffic: normalTraffic() });
    expect(cards.map((c) => c.label)).toEqual(["Visits", "Conversion rate", "Looked at a product", "Added to cart", "Left with a full cart", "Left at checkout"]);
    expect(cards[1].value).toBe("3.0 %");
    expect(cards[2].value).toBe("60.0 %");
    for (const c of cards) {
      expect(c.state ?? "ok").toBe("ok");
      expect(c.help, c.label).toBeTruthy();
    }
  });

  it("is all 'missing' with a link to settings when visits are not counted, never 0 %", () => {
    const cards = funnelCards({ base: "/admin/shop", traffic: noVisits() });
    for (const c of cards) {
      expect(c.state).toBe("missing");
      expect(c.value).toBeNull();
      expect(c.missing?.action?.href).toBe("/admin/shop/analytics/settings#visits");
    }
  });
});

// ---------- the page ----------

describe("TrafficView, visit counting off and nothing sold", () => {
  const out = text(emptyProps());

  it("asks the owner to turn visit counting on, with a link, and says what it does", () => {
    expect(out).toContain("Turn on visit counting to see where visitors come from");
    expect(out).toContain("/admin/shop/analytics/settings#visits");
    expect(out).toContain("no cookies");
    expect(out).toContain("only counts from the day you switch it on");
  });

  it("does not say the same thing twice", () => {
    expect(out).not.toContain("Visit counting is off, so visits, the funnel");
  });

  it("has no funnel, no device table, no landing table, and says why", () => {
    expect(out).not.toContain("Visits, product views, carts, checkouts and purchases");
    expect(out).toContain("There is no funnel to show yet. Visit counting is off.");
    expect(out).toContain("There are no devices to compare yet.");
    expect(out).toContain("There are no landing pages to show yet.");
  });

  it("is calm everywhere else: empty states, no NaN, no zero percent", () => {
    expect(out).toContain("No paid orders in this period yet.");
    expect(out).toContain("No one used the store's search in this period.");
    expect(out).not.toMatch(BAD);
    expect(out).not.toContain("0.0 %");
  });

  it("still tells that sales after a search are not tracked", () => {
    expect(out).toContain("Sales after a search are not tracked");
  });
});

describe("TrafficView, visit counting off but orders and searches exist", () => {
  const out = text(props({ traffic: noVisits() }));

  it("shows what does not need visits: countries, cities, searches, the weekday pattern", () => {
    expect(out).toContain("Norway");
    expect(out).toContain("Oslo");
    expect(out).toContain("Searches that found nothing: products your customers want");
    expect(out).toContain("Friday is your best day of the week");
  });

  it("says the orders came from orders when there is no funnel", () => {
    expect(out).toContain("Your store did make 90 paid orders in this period. That comes from your orders, not from visits.");
  });

  it("shows visits per country as a dash with the reason", () => {
    expect(out).toContain("Needs counted visits. Visit counting is off.");
    expect(out).not.toMatch(BAD);
  });
});

describe("TrafficView, counting is on but no visit has come", () => {
  it("says no visit has been counted yet, and does not ask to turn counting on", () => {
    const out = text(props({ traffic: noVisits({ counting: true, coverage: { counting: true, firstDay: null, partial: true, from: null, to: null, days: 0 }, notes: ["No visit has been counted yet."] }) }));
    expect(out).toContain("No visit has been counted yet");
    expect(out).not.toContain("Turn on visit counting");
    expect(out).not.toMatch(BAD);
  });

  it("says visits began after this period", () => {
    const out = text(props({ traffic: noVisits({ counting: true, coverage: { counting: true, firstDay: "2026-10-01", partial: true, from: null, to: null, days: 0 }, notes: [] }) }));
    expect(out).toContain("No visits were counted in this period");
    expect(out).toContain("1 Oct 2026");
  });
});

describe("TrafficView, a normal store", () => {
  const out = text(props());

  it("opens with the three things it answers, linked to their sections", () => {
    expect(out).toContain("This page answers three things");
    for (const id of ["funnel", "search", "when"]) {
      expect(out).toContain(`href="#${id}"`);
      expect(out).toContain(`id="${id}"`);
    }
  });

  it("draws the funnel with a name, and the rates beside it", () => {
    expect(out).toContain('aria-label="Visits, product views, carts, checkouts and purchases"');
    expect(out).toContain("Conversion rate: paid orders divided by visits");
    expect(out).toContain("3.0 %");
  });

  it("shows the phone warning in plain words", () => {
    expect(out).toContain("Phones sell much less than computers");
    expect(out).toContain("60 % of your visitors use a phone");
  });

  it("shows the device table with an Unknown row that explains itself", () => {
    expect(out).toContain("Unknown");
    expect(out).toContain("cannot be tied to a counted visit");
    const unknownRow = out.match(/<tr[^>]*>(?:(?!<\/tr>)[\s\S])*>Unknown<[\s\S]*?<\/tr>/);
    expect(unknownRow).not.toBeNull();
    expect(unknownRow![0]).toContain("–");
  });

  it("shows countries with visits and conversion, a country with no sale, and the country chooser", () => {
    expect(out).toContain("Norway");
    expect(out).toContain("Denmark");
    expect(out).toContain("Front door (country chooser)");
    expect(out).toContain("All countries");
  });

  it("shows the cities with the other cities and no-address lines", () => {
    expect(out).toContain("Oslo");
    expect(out).toContain("Other cities (9)");
    expect(out).toContain("No address");
  });

  it("shows landing pages with a product by its handle", () => {
    expect(out).toContain("wool-sweater");
    expect(out).toContain("Product page");
  });

  it("puts the searches that found nothing first, under a heading that says why they matter", () => {
    const zero = out.indexOf("Searches that found nothing: products your customers want");
    expect(zero).toBeGreaterThan(-1);
    expect(zero).toBeLessThan(out.indexOf("Most searched"));
    expect(zero).toBeLessThan(out.indexOf("Click-through"));
    expect(out).toContain("gift card");
    expect(out).toContain("Showing 2 of 25 different searches that found nothing.");
  });

  it("shows what shoppers typed as text, never as markup", () => {
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("&lt;script&gt;alert(1)");
  });

  it("says the best day and hour in words and draws the heatmap with a name", () => {
    expect(out).toContain("Friday is your best day of the week");
    expect(out).toContain('aria-label="Paid orders by weekday and two-hour band"');
    expect(out).toContain("Europe/Oslo");
  });

  it("has no NaN, Infinity or undefined anywhere", () => {
    expect(out).not.toMatch(BAD);
  });

  it("gives every chart, list and table a name", () => {
    const svgs = [...out.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]).filter((s) => /role="img"/.test(s));
    expect(svgs.length).toBeGreaterThan(0);
    for (const s of svgs) expect(s).toMatch(/aria-label="[^"]{3,}"/);
    const lists = [...out.matchAll(/<ol\b[^>]*>/g)].map((m) => m[0]);
    expect(lists.length).toBeGreaterThan(1);
    for (const l of lists) expect(l).toMatch(/aria-label="[^"]{3,}"/);
    const tables = [...out.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);
    expect(tables.length).toBeGreaterThan(4);
    for (const t of tables) expect(t).toMatch(/<caption/);
  });

  it("needs no script", () => {
    expect(out).not.toContain("<script");
  });
});

describe("TrafficView, partial coverage and currency notes", () => {
  it("shows the traffic report's notes and the currencies that were left out", () => {
    const notes = ["Visits have been counted since 2026-09-20, so these figures cover only the days from then.", "5 paid orders fall outside the days with counted visits and are left out of the rates."];
    const out = text(
      props({
        traffic: normalTraffic({ coverage: coverage({ partial: true, firstDay: "2026-09-20", from: "2026-09-20", days: 13 }), notes, unconverted: 3, missingCurrencies: ["SEK"] }),
        geo: normalGeo({ unconverted: 3, missingCurrencies: ["SEK"] }),
        time: timeOf(NORMAL_ROWS, { unconverted: 3, missingCurrencies: ["SEK"] }),
      }),
    );
    for (const n of notes) expect(out).toContain(n);
    expect(out).toContain("3 paid orders in SEK are left out because the store has no exchange rate for it");
    expect(out).toContain("Over the 13 days with counted visits.");
  });

  it("does not repeat a cut funnel step in two places", () => {
    const traffic = normalTraffic({ funnel: funnel({ sessions: 100, productViewers: 50, carts: 20, checkouts: 10, purchases: 12 }) });
    const out = text(props({ traffic }));
    expect(out).toContain("Counted as 12, shown as 10: a step cannot be bigger than the one before it.");
    expect(out.match(/shown as 10/g)).toHaveLength(1);
  });

  it("says older searches are not kept, and what the page shows instead", () => {
    const out = text(props({ search: normalSearch({ clamped: true, requested: { from: "2026-05-01", to: "2026-10-03", days: 155 }, period: { from: "2026-07-05", to: "2026-10-03", days: 90 } }) }));
    expect(out).toContain("Older searches are no longer kept");
    expect(out).toContain("Searches are kept for 90 days, so this shows 5 Jul 2026 onwards, not 1 May 2026.");
  });

  it("says a period older than the searches kept has nothing to show", () => {
    const out = text(props({ search: emptySearch({ clamped: true, requested: { from: "2026-01-01", to: "2026-02-01", days: 31 }, period: { from: "2026-07-05", to: "2026-07-05", days: 0 } }) }));
    expect(out).toContain("all of this period is older");
    expect(out).toContain("There are no searches to show for this period.");
  });
});

describe("TrafficView, search edge cases", () => {
  it("says so when no search found nothing, as good news", () => {
    const out = text(props({ search: normalSearch({ zeroTerms: [], zeroTermCount: 0, totals: { searches: 50, distinctTerms: 20, zeroResultSearches: 0, zeroRate: 0, clickedSearches: 20, clickThrough: 0.4, clickThroughOfFound: 0.4 } }) }));
    expect(out).toContain("Every search in this period showed at least one product. Nothing is being missed.");
    expect(out).toContain("0.0 %");
  });

  it("writes an empty search as words", () => {
    const out = text(props({ search: normalSearch({ zeroTerms: [{ term: "", searches: 2, lastSearchedAt: "2026-09-12T08:00:00.000Z" }] }) }));
    expect(out).toContain("(empty search)");
  });

  it("shows the click-through of the searches that found something only when it is known", () => {
    const out = text(props({ search: normalSearch({ totals: { searches: 4, distinctTerms: 2, zeroResultSearches: 4, zeroRate: 1, clickedSearches: 0, clickThrough: 0, clickThroughOfFound: null } }) }));
    expect(out).not.toMatch(BAD);
    expect(out).not.toContain("of the searches that found something");
  });
});

describe("TrafficView, sales pattern edge cases", () => {
  it("makes no claim from a handful of orders", () => {
    const out = text(props({ time: timeOf([{ weekday: 5, hour: 14, orders: 3, revenueMinor: 300_000 }]) }));
    expect(out).toContain("Only 3 paid orders in this period: too few to say which day or hour sells best.");
    expect(out).not.toContain("is your best day of the week");
    expect(out).not.toMatch(BAD);
  });

  it("draws no weekday bars when nothing sold", () => {
    const out = text(props({ time: timeOf([]) }));
    expect(out).not.toContain("Paid orders for each weekday");
    expect(out).toContain("No paid orders in this period yet.");
  });
});
