/**
 * What Kaizena Flow measures of each store (D314, `docs/capacity.md` 3): a *gauge* is a level measured once a day (the storage a store
 * holds), a *counter* is a sum over the day (requests, emails). Metering is in UTC days and calendar months. Pure: the browser may import it.
 */

export type MetricKind = "gauge" | "counter";
/** `micros`: millionths of a US dollar, as `src/lib/ai-cost.ts` prices a call. */
export type MetricUnit = "bytes" | "count" | "micros";
export type MetricSource = "storage" | "database" | "traffic" | "email" | "ai";

export const USAGE_METRICS = {
  /** Every file the store keeps in Storage. */
  storage_bytes: { kind: "gauge", unit: "bytes", source: "storage" },
  /** Products not archived. */
  products: { kind: "gauge", unit: "count", source: "database" },
  /** Members not disabled, collaborators whose time has not run out. */
  staff_seats: { kind: "gauge", unit: "count", source: "database" },
  /** The store's own domains. */
  custom_domains: { kind: "gauge", unit: "count", source: "database" },
  /** Requests to the store's hosts, from Vercel's log drain. */
  requests: { kind: "counter", unit: "count", source: "traffic" },
  /** Bytes sent to visitors, from the drain. */
  egress_bytes: { kind: "counter", unit: "bytes", source: "traffic" },
  /** Answers with a 5xx status, from the drain. */
  server_errors: { kind: "counter", unit: "count", source: "traffic" },
  /** Every email sent for the store. */
  emails: { kind: "counter", unit: "count", source: "email" },
  /** Broadcasts, automations and review requests only (`MARKETING_EMAIL_KINDS`). */
  marketing_emails: { kind: "counter", unit: "count", source: "email" },
  /** The AI used on Kaizena Flow's key (never a store's own key). */
  ai_cost_micros: { kind: "counter", unit: "micros", source: "ai" },
} as const satisfies Record<string, { kind: MetricKind; unit: MetricUnit; source: MetricSource }>;

export type UsageMetric = keyof typeof USAGE_METRICS;
export const USAGE_METRIC_IDS = Object.keys(USAGE_METRICS) as UsageMetric[];

/** The metrics only the drain writes; the daily measuring never touches them. */
export const TRAFFIC_METRICS = USAGE_METRIC_IDS.filter((m) => USAGE_METRICS[m].source === "traffic");

/** The email kinds that count as marketing (D297 broadcasts, D298 automations), written out: never a prefix match. */
export const MARKETING_EMAIL_KINDS = ["marketing.broadcast", "marketing.automation", "marketing.review_request"] as const;

export type UsageDay = { day: string; value: number };

/** A month's figure: a gauge's latest day, a counter's sum. */
export function monthFigure(rows: readonly UsageDay[], metric: UsageMetric): number {
  if (rows.length === 0) return 0;
  if (USAGE_METRICS[metric].kind === "counter") return rows.reduce((sum, row) => sum + row.value, 0);
  return [...rows].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))[0].value;
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** The UTC calendar month a moment is in, as first and last day (`YYYY-MM-DD`) and its key (`YYYY-MM`). */
export function monthOf(date: Date): { start: string; end: string; key: string } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: isoDay(start), end: isoDay(end), key: isoDay(start).slice(0, 7) };
}

/** A UTC day (`YYYY-MM-DD`), `offset` days from the moment's. */
export function utcDay(date: Date, offset = 0): string {
  return isoDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + offset)));
}
