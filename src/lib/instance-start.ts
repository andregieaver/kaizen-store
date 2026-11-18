/**
 * A server instance's cold start as a production figure (bloat review step 1.16): what it was started for, the milliseconds to the end of
 * `register()` and to its first answer, its resident memory and the bytes of translated text it read at start. Pure, with no import, so the
 * beacons and the proxy can reach it through `src/server/instance-start.ts` without loading anything. The five fields are the whole of the
 * log line `instance.start` and of the row in `commerce.instance_starts`: nothing of the request is ever part of them.
 */

export const INSTANCE_KINDS = ["health", "beacon", "proxy", "store", "pay", "site", "admin", "platform_admin", "api", "job"] as const;

export type InstanceKind = (typeof INSTANCE_KINDS)[number];

/** The targets, in milliseconds: the proxy's is its distance from the health check's median; a store page's and an admin page's are their own. */
export const COLD_START_LINES_MS = { proxy: 150, store: 400, admin: 600 } as const;

/** Translated text read at start beyond this (1 MB) is a line in the platform's briefing. */
export const UI_BYTES_ALERT = 1_048_576;

export type InstanceStartFields = {
  kind: InstanceKind;
  registerMs: number | null;
  firstMs: number;
  rssMb: number;
  uiBytes: number;
};

const MS_MAX = 600_000;
const RSS_MB_MAX = 100_000;

const whole = (n: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0);

/** The five fields as whole numbers, each held to the table's checks. */
export function instanceStartFields(
  kind: InstanceKind,
  t: { registerMs: number | null; firstMs: number; rssBytes: number; uiBytes: number },
): InstanceStartFields {
  return {
    kind,
    registerMs: t.registerMs === null ? null : whole(t.registerMs, MS_MAX),
    firstMs: whole(t.firstMs, MS_MAX),
    rssMb: whole(Math.round(t.rssBytes / 1_048_576), RSS_MB_MAX),
    uiBytes: whole(t.uiBytes, Number.MAX_SAFE_INTEGER),
  };
}

export type ColdStartRow = {
  kind: InstanceKind;
  /** Cold starts a day: the starts divided by the days in the input, one decimal. */
  perDay: number;
  p50: number;
  p95: number;
  /** For the proxy and the beacons: the median minus the health check's median; null when there is no health row. */
  overHealth?: number | null;
};

/** The nearest-rank percentile of sorted values. */
function nearestRank(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

/** Cold starts by kind (those with a row, in the order of `INSTANCE_KINDS`): a day, the median and the 95th percentile. */
export function coldStartRows(rows: { day: string; kind: InstanceKind; firstMs: number }[]): ColdStartRow[] {
  const days = new Set(rows.map((r) => r.day)).size || 1;
  const byKind = new Map<InstanceKind, number[]>();
  for (const row of rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.firstMs]);
  const median = (kind: InstanceKind) => {
    const values = byKind.get(kind);
    return values ? nearestRank([...values].sort((a, b) => a - b), 0.5) : null;
  };
  const health = median("health");
  return INSTANCE_KINDS.filter((kind) => byKind.has(kind)).map((kind) => {
    const sorted = [...(byKind.get(kind) as number[])].sort((a, b) => a - b);
    const p50 = nearestRank(sorted, 0.5);
    const row: ColdStartRow = { kind, perDay: Math.round((sorted.length / days) * 10) / 10, p50, p95: nearestRank(sorted, 0.95) };
    if (kind === "proxy" || kind === "beacon") row.overHealth = health === null ? null : p50 - health;
    return row;
  });
}
