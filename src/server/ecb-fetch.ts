import "server-only";

import { addDays } from "@/lib/analytics-period";
import { ECB_HIST_90D_URL, ECB_HIST_URL, MAX_ECB_BYTES, ecbPortalUrl, isEcbUrl, parseEcbCsv, parseEcbHistory, type EcbRate } from "@/lib/ecb-history";

/**
 * The only code that asks the European Central Bank for its reference rates (D161, `docs/wave-1c-reports.md` 4.5). No database here, so
 * a test holds it with a fetch of its own: the hosts and paths are constants of `src/lib/ecb-history.ts` (a request to any other address
 * is refused before it is made, and nothing in an address comes from a person or from stored data), a request has a timeout and no
 * cache, the answer is read as text with a size cap, and anything that is not HTTP 200 with the expected shape is `null`, "unavailable".
 * The rates are published for information; the page says so.
 */

export type EcbFetch = (url: string, init: { signal: AbortSignal; cache: "no-store" }) => Promise<Response>;

export const ECB_TIMEOUT_MS = 10_000;

const realFetch: EcbFetch = (url, init) => fetch(url, init);

/** An answer as text, or null: not an ECB address, not 200, too big, or the connection failed. Never throws. */
export async function ecbText(url: string, fetcher: EcbFetch = realFetch): Promise<string | null> {
  if (!isEcbUrl(url)) return null;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(ECB_TIMEOUT_MS), cache: "no-store" });
    if (!response.ok || response.status !== 200) return null;
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_ECB_BYTES) return null;
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      return text.length > MAX_ECB_BYTES ? null : text;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ECB_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

/** The last ninety days of every currency (the daily job's request), or null when the ECB cannot be read. */
export async function latestRates(fetcher: EcbFetch = realFetch): Promise<EcbRate[] | null> {
  const xml = await ecbText(ECB_HIST_90D_URL, fetcher);
  return xml === null ? null : parseEcbHistory(xml);
}

export type DayRates = { rates: EcbRate[]; via: "portal" | "feed_90d" | "feed_all" };

/**
 * The rates of one currency from `day` to a week after (enough to reach the next day of publication), asked the cheapest way first: the
 * data portal's single series, then the 90-day feed when the day is within it, then the full history (8 MB) with only the wanted days
 * read. Null when none of them answers.
 */
export async function ratesNearDay(currency: string, day: string, today: string, fetcher: EcbFetch = realFetch): Promise<DayRates | null> {
  const end = addDays(day, 7);
  let url: string;
  try {
    url = ecbPortalUrl(currency, day, end);
  } catch {
    return null;
  }
  const csv = await ecbText(url, fetcher);
  const parsed = csv === null ? null : parseEcbCsv(csv, currency);
  if (parsed && parsed.length > 0) return { rates: parsed, via: "portal" };

  const wanted = new Set<string>();
  for (let d = day; d <= end; d = addDays(d, 1)) wanted.add(d);
  if (day >= addDays(today, -80)) {
    const xml = await ecbText(ECB_HIST_90D_URL, fetcher);
    const rates = xml === null ? null : parseEcbHistory(xml, wanted);
    if (rates) return { rates: rates.filter((r) => r.currency === currency), via: "feed_90d" };
  }
  const xml = await ecbText(ECB_HIST_URL, fetcher);
  const rates = xml === null ? null : parseEcbHistory(xml, wanted);
  return rates ? { rates: rates.filter((r) => r.currency === currency), via: "feed_all" } : null;
}
