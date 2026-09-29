/**
 * The European Central Bank's euro foreign exchange reference rates (D109),
 * published each working day as XML: `<Cube currency="NOK" rate="11.6"/>`,
 * units of the currency per 1 EUR, which is what a store's rates are.
 */
export const ECB_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export type EcbRates = { date: string | null; rates: Map<string, number> };

export function parseEcbRates(xml: string): EcbRates {
  const rates = new Map<string, number>();
  for (const match of xml.matchAll(/<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]\s*\/?>/g)) {
    const rate = Number(match[2]);
    if (Number.isFinite(rate) && rate > 0) rates.set(match[1], rate);
  }
  const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? null;
  return { date, rates };
}
