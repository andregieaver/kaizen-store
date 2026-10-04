/**
 * The European Central Bank's euro reference rates, for the OSS and IOSS euro figures (D161, `docs/wave-1c-reports.md` 4.5). Pure:
 * the constants (hosts and paths, never built from a person's input or stored data), the parsers of the ECB's two feeds, the rule for
 * which day's rate a period uses, and the euro arithmetic in BigInt (no floats). `src/server/ecb-rates.ts` does the fetching.
 *
 * NOTHING HERE IS LEGAL OR TAX ADVICE; needs review by an accountant. Sources, read 2026-10-04:
 * - European Commission, One Stop Shop Guidelines (30 July 2021), Part 2 Q15: one currency, in general euro, converted at "the exchange
 *   rate as published by the European Central Bank on the last date of the tax period"; Skatteverket's OSS page says the same for a
 *   Swedish identification state ("for the last day of the reporting period").
 * - Directive 2006/112/EC Art. 369h as at https://www.legislation.gov.uk/eudr/2006/112/article/369h/data.html (the text at the UK's
 *   exit): "the exchange rates published by the European Central Bank for that day, or, if there is no publication on that day, on the
 *   next day of publication". The article numbers after the 2021 renumbering were NOT read: verify before relying on the number.
 * - ECB, https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html: published about
 *   16:00 CET each working day except TARGET closing days; "for information purposes only. Using the rates for transaction purposes
 *   is strongly discouraged" (a disclaimer the screen repeats). Feeds `eurofxref-hist-90d.xml` and `eurofxref-hist.xml`.
 * - ECB data portal, `data-api.ecb.europa.eu/service/data/EXR/D.{CCY}.EUR.SP00.A?...&format=csvdata`: one currency, a date range.
 * - TARGET closing days (the ECB publishes no rate): 1 January, Good Friday, Easter Monday, 1 May, 25 and 26 December.
 */
import { addDays, isoWeekday } from "./analytics-period";

/** The ECB's hosts and paths. Constants: a request to anything else is a bug. */
export const ECB_HOSTS = ["www.ecb.europa.eu", "data-api.ecb.europa.eu"] as const;
export const ECB_HIST_90D_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export const ECB_HIST_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
const ECB_PORTAL = "https://data-api.ecb.europa.eu/service/data/EXR";

/**
 * The currencies the ECB publishes a euro reference rate for (read 2026-10-04 from its reference-rates page; HRK and RUB stopped being
 * published in 2022 but are still asked for on days before). An owner's request for any other code is refused before anything is
 * fetched: such a request could only end in the 8 MB full-history download and an "unavailable".
 */
export const ECB_CURRENCIES: ReadonlySet<string> = new Set([
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "GBP", "HKD", "HRK", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR",
  "NOK", "NZD", "PHP", "PLN", "RON", "RUB", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
]);

/** The biggest answer read (the full history is about 8 MB); anything bigger is "unavailable". */
export const MAX_ECB_BYTES = 16 * 1024 * 1024;
/** The portal's single-series request for a currency over a range of days (at most 31 days). */
export function ecbPortalUrl(currency: string, from: string, to: string): string {
  if (!/^[A-Z]{3}$/.test(currency) || currency === "EUR") throw new RangeError(`Not a currency the ECB publishes: ${currency}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) throw new RangeError("Not a range of days");
  return `${ECB_PORTAL}/D.${currency}.EUR.SP00.A?startPeriod=${from}&endPeriod=${to}&format=csvdata`;
}

/** Whether an address is one of the ECB's (a test uses it to hold that nothing else is ever requested). */
export function isEcbUrl(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && (ECB_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** One published rate: units of `currency` per 1 EUR on `date`; the rate is a decimal string with at most six decimals. */
export type EcbRate = { date: string; currency: string; rate: string };

const RATE = /^\d{1,9}(\.\d{1,6})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

const valid = (date: string, currency: string, rate: string): boolean => DAY.test(date) && CURRENCY.test(currency) && currency !== "EUR" && RATE.test(rate) && Number(rate) > 0;

/**
 * The 90-day feed or the full history (`<Cube time="2026-09-30"><Cube currency="DKK" rate="7.4755"/>...`). Null when the answer is
 * too big or holds no day at all (unavailable); a row that does not parse is skipped. Optional `days` keeps only the wanted days (the
 * full file is 8 MB and only a few days of it are needed).
 */
export function parseEcbHistory(xml: string, days?: ReadonlySet<string>): EcbRate[] | null {
  if (typeof xml !== "string" || xml.length === 0 || xml.length > MAX_ECB_BYTES) return null;
  const out: EcbRate[] = [];
  let sawDay = false;
  const dayBlock = /<Cube\s+time="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g;
  for (const day of xml.matchAll(dayBlock)) {
    sawDay = true;
    if (days && !days.has(day[1])) continue;
    for (const row of day[2].matchAll(/<Cube\s+currency="([A-Z]{3})"\s+rate="([0-9.]+)"\s*\/>/g)) {
      if (valid(day[1], row[1], row[2])) out.push({ date: day[1], currency: row[1], rate: row[2] });
    }
  }
  return sawDay ? out : null;
}

/** One CSV record's fields (RFC 4180: quoted fields, doubled quotes). */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(current);
      current = "";
    } else current += ch;
  }
  fields.push(current);
  return fields;
}

/**
 * The data portal's CSV for one currency (`TIME_PERIOD` and `OBS_VALUE` columns, `CURRENCY` when present). Null when the answer is
 * not that (no header, no such column, too big): the caller treats it as unavailable. A row with a missing or odd value is skipped.
 */
export function parseEcbCsv(csv: string, currency?: string): EcbRate[] | null {
  if (typeof csv !== "string" || csv.length === 0 || csv.length > MAX_ECB_BYTES) return null;
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  const header = csvFields(lines[0]).map((h) => h.trim());
  const time = header.indexOf("TIME_PERIOD");
  const value = header.indexOf("OBS_VALUE");
  const cur = header.indexOf("CURRENCY");
  if (time < 0 || value < 0 || (cur < 0 && !currency)) return null;
  const out: EcbRate[] = [];
  for (const line of lines.slice(1)) {
    const f = csvFields(line);
    const code = (cur >= 0 ? f[cur] : currency ?? "").trim();
    const date = (f[time] ?? "").trim();
    const rate = (f[value] ?? "").trim();
    if (valid(date, code, rate)) out.push({ date, currency: code, rate });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Publication days
// ---------------------------------------------------------------------------

/** Easter Sunday of a year (the anonymous Gregorian algorithm), as `YYYY-MM-DD`. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Whether the ECB normally publishes its reference rates on a day: a working day that is not a TARGET closing day. */
export function isEcbPublicationDay(day: string): boolean {
  if (isoWeekday(day) > 5) return false;
  const md = day.slice(5);
  if (md === "01-01" || md === "05-01" || md === "12-25" || md === "12-26") return false;
  const easter = easterSunday(Number(day.slice(0, 4)));
  return day !== addDays(easter, -2) && day !== addDays(easter, 1);
}

/** The first day on or after `day` the ECB normally publishes. */
export function nextPublicationDay(day: string): string {
  let d = day;
  for (let i = 0; i < 10 && !isEcbPublicationDay(d); i += 1) d = addDays(d, 1);
  return d;
}

/**
 * The rate a day's figures are converted at: that day's reference rate, or if none was published that day the next day of publication
 * (Directive Art. 369h as read). `rates` are the stored rates (any order, any currency). Null when the rate is not stored: the day is
 * not yet published or fetched, or the currency is not published. A rate on a day the calendar above does not expect is used when it
 * is the first stored one on or after the day and not later than the expected next publication day, so a feed that publishes on an
 * unusual day is not ignored.
 */
export function ecbRateFor(rates: readonly EcbRate[], currency: string, day: string): { rate: string; date: string } | null {
  const target = nextPublicationDay(day);
  let best: EcbRate | null = null;
  for (const r of rates) {
    if (r.currency !== currency || r.date < day || r.date > target) continue;
    if (!best || r.date < best.date) best = r;
  }
  return best ? { rate: best.rate, date: best.date } : null;
}

// ---------------------------------------------------------------------------
// Euro arithmetic
// ---------------------------------------------------------------------------

const ZERO = BigInt(0);
const TWO = BigInt(2);
const SCALE = BigInt(1_000_000);

/** A rate as a whole number of millionths. Throws on anything but a positive decimal with at most six decimals. */
export function rateScaled(rate: string): bigint {
  if (typeof rate !== "string" || !RATE.test(rate)) throw new RangeError(`Not a rate: ${rate}`);
  const [whole, fraction = ""] = rate.split(".");
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
  if (scaled <= ZERO) throw new RangeError(`Not a rate: ${rate}`);
  return scaled;
}

/**
 * An amount in a currency's minor units as euro cents at an ECB rate (units of the currency per 1 EUR): `round_half_up(amount / rate)`.
 * Exact integers (BigInt), no floats. The sign is kept and the rounding is done on the absolute value, so a credit is exactly the
 * negative of the same invoice's amount. Every currency Kaizen offers has two decimals (`src/lib/money.ts`), so cents map to cents.
 * 1000.00 DKK at 7.4755 is 133.77 EUR; 250.00 DKK is 33.44 EUR.
 */
export function toEuroMinor(amountMinor: number, rate: string): number {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError(`Amount must be a whole number of minor units: ${amountMinor}`);
  const r = rateScaled(rate);
  const negative = amountMinor < 0;
  const abs = BigInt(negative ? -amountMinor : amountMinor);
  const eur = (TWO * abs * SCALE + r) / (TWO * r);
  return negative && eur !== ZERO ? -Number(eur) : Number(eur);
}
