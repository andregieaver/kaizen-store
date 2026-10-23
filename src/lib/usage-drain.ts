/**
 * Reading Vercel's log drain for D314 (`docs/capacity.md` step 1.4): requests and server errors per store and UTC day, and nothing
 * else. Each entry is reduced at once to its host, status, request id and time; an IP address, user agent, path, query, referrer or
 * message is never kept, logged or returned. Fields as documented at vercel.com/docs/drains/reference/logs (read 2026-10-23): a JSON
 * array or NDJSON of log objects, the request in `proxy` (`host`, `path`, `statusCode`, `timestamp`), `requestId` shared by every
 * line one request logs. The documented schema has no response size, so bandwidth is not read from it. Pure.
 */

export type DrainEntry = { host: string; status: number; request: string; at: number; path: string };
export type StoreKey = string | null;
export type TrafficTotal = { storeId: StoreKey; day: string; requests: number; serverErrors: number; estimated: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The objects of a drain body: a JSON array, one object, or one object per line. Anything unreadable is left out. */
function objectsOf(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.filter(isRecord);
    if (isRecord(parsed)) return [parsed];
  } catch {
    // NDJSON, below.
  }
  const out: Record<string, unknown>[] = [];
  for (const line of trimmed.split("\n")) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) out.push(parsed);
    } catch {
      // A broken line is skipped.
    }
  }
  return out;
}

/**
 * The requests in a drain body: only production entries that carry a request (`proxy`), each reduced to what is counted. The path is
 * kept only to find a store under `/s/{slug}` and must never leave the totals.
 */
export function parseDrainBody(text: string): DrainEntry[] {
  const entries: DrainEntry[] = [];
  for (const object of objectsOf(text)) {
    if (object.environment !== undefined && object.environment !== "production") continue;
    const proxy = object.proxy;
    if (!isRecord(proxy)) continue;
    const host = typeof proxy.host === "string" ? proxy.host.toLowerCase().replace(/:\d+$/, "") : "";
    const status = typeof proxy.statusCode === "number" ? proxy.statusCode : typeof object.statusCode === "number" ? object.statusCode : 0;
    const at = typeof proxy.timestamp === "number" ? proxy.timestamp : typeof object.timestamp === "number" ? object.timestamp : NaN;
    const request = typeof object.requestId === "string" && object.requestId !== "" ? object.requestId : typeof object.id === "string" ? object.id : "";
    const path = typeof proxy.path === "string" ? proxy.path : "";
    if (!host || !Number.isFinite(at) || !request) continue;
    entries.push({ host, status, request, at, path });
  }
  return entries;
}

/** A store's slug from a path on Kaizena Flow's own host (`/s/{slug}/…`), else null. */
export function slugInPath(path: string): string | null {
  const match = /^\/s\/([a-z0-9][a-z0-9-]{0,62})(?:[/?#]|$)/.exec(path);
  return match ? match[1] : null;
}

/**
 * Totals per store and UTC day. One request is counted once, however many lines it logged (by its request id, within the batch); a
 * status of 500 or more is a server error. A host no store or Kaizena Flow owns (`storeOf` gives undefined) is dropped and counted.
 * Totals are scaled by the sampling rate, and marked estimated when it is below 1.
 */
export function trafficTotals(
  entries: readonly DrainEntry[],
  storeOf: (host: string, path: string) => StoreKey | undefined,
  sampleRate = 1,
): { totals: TrafficTotal[]; unknownHosts: number } {
  const rate = sampleRate > 0 && sampleRate <= 1 ? sampleRate : 1;
  const seen = new Set<string>();
  const sums = new Map<string, { storeId: StoreKey; day: string; requests: number; serverErrors: number }>();
  let unknownHosts = 0;
  for (const entry of entries) {
    if (seen.has(entry.request)) continue;
    seen.add(entry.request);
    const storeId = storeOf(entry.host, entry.path);
    if (storeId === undefined) {
      unknownHosts += 1;
      continue;
    }
    const day = new Date(entry.at).toISOString().slice(0, 10);
    const key = `${storeId ?? ""}|${day}`;
    const sum = sums.get(key) ?? { storeId, day, requests: 0, serverErrors: 0 };
    sum.requests += 1;
    if (entry.status >= 500) sum.serverErrors += 1;
    sums.set(key, sum);
  }
  const totals = [...sums.values()].map((sum) => ({
    storeId: sum.storeId,
    day: sum.day,
    requests: Math.round(sum.requests / rate),
    serverErrors: Math.round(sum.serverErrors / rate),
    estimated: rate < 1,
  }));
  return { totals, unknownHosts };
}
