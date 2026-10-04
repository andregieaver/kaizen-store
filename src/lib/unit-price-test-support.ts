/**
 * Test support for the unit price's country table (D160): no country allows 100 g or 100 ml today
 * (`UNIT_PRICE_COUNTRY_RULES`), so the mechanism that shows the small base where a rule allows it can only be tested by
 * opening a country for the length of a test. Tests only; the app never imports this.
 */
import { UNIT_PRICE_COUNTRY_RULES, type CountryRule } from "./unit-price-rules";

/**
 * Allows the small base in these countries until the returned function is called, which puts the table back as it was.
 * Call it in `beforeAll` (or `beforeEach`) and the returned function in `afterAll` (or `afterEach`).
 */
export function allowSmallBase(...countries: string[]): () => void {
  const before = new Map<string, CountryRule | undefined>();
  for (const code of countries) {
    before.set(code, UNIT_PRICE_COUNTRY_RULES[code]);
    UNIT_PRICE_COUNTRY_RULES[code] = {
      smallBaseAllowed: true,
      verified: false,
      source: "Opened for a test only: no source was read that allows the small base.",
    };
  }
  return () => {
    for (const [code, rule] of before) {
      if (rule) UNIT_PRICE_COUNTRY_RULES[code] = rule;
      else delete UNIT_PRICE_COUNTRY_RULES[code];
    }
  };
}
