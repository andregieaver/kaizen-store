import type { EmailContent } from "./email-layout";

/**
 * The email an A/B test's guardrail sends the store's owners when it stops a test by itself (D148, phase 6). Pure: the figures
 * are counted in code (`experimentResults()`), the sentences here only put them in words. Kaizen writes to owners in English, as the
 * admin is. It says what happened and what the owner may do, never why: the figures do not say why a version did worse.
 */

export type GuardrailFacts = {
  storeName: string;
  testName: string;
  /** What was tested, as the list of tests names it (`/om-oss`, `Header: Spring header`). */
  target: string;
  /** The version that did clearly worse, by its key and name. */
  version: { key: string; name: string; visitors: number; buyers: number };
  original: { visitors: number; buyers: number };
  /** Whole days the test ran. */
  days: number;
  /** The test's results page in the admin. */
  url: string;
};

const FOOTER = ["Kaizen · kaizenstore.cloud"];

const number = (n: number) => n.toLocaleString("en-GB");
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Orders per hundred visitors, as the owner reads it: `2.6 %`. */
export function orderRate(buyers: number, visitors: number): string {
  if (visitors <= 0) return "0 %";
  const rate = (buyers / visitors) * 100;
  return `${rate.toLocaleString("en-GB", { maximumFractionDigits: rate < 10 ? 1 : 0 })} %`;
}

export function guardrailEmail(facts: GuardrailFacts): EmailContent {
  const { version, original } = facts;
  const letter = version.key.toUpperCase();
  const figures = `${number(version.buyers)} of ${number(version.visitors)} visitors who saw version ${letter} ordered (${orderRate(version.buyers, version.visitors)}), against ${number(original.buyers)} of ${number(original.visitors)} who saw the original (${orderRate(original.buyers, original.visitors)}).`;
  return {
    subject: `Your A/B test "${facts.testName}" was stopped: fewer orders in version ${letter}`,
    preview: `Version ${letter} clearly got fewer orders than the original, so Kaizen stopped the test. Everyone sees the original again.`,
    lang: "en",
    footer: [facts.storeName, ...FOOTER],
    blocks: [
      { type: "heading", text: "Kaizen stopped your A/B test" },
      {
        type: "paragraph",
        text: `The test "${facts.testName}" of ${facts.target} in ${facts.storeName} had run for ${days(facts.days)} when version ${letter} (${version.name}) clearly got fewer orders per visitor than the original. It was far enough behind that luck is a very unlikely reason, so Kaizen stopped the test to protect your sales.`,
      },
      { type: "paragraph", text: figures },
      {
        type: "paragraph",
        text: "Nobody new is given a version any more, and everyone sees the page as it was before the test. Nothing was changed on it and what was counted is kept.",
      },
      {
        type: "paragraph",
        text: "Open the results to read them. You can discard the test, or, if you still want to use one of the other versions, apply it. Kaizen does not apply anything by itself.",
      },
      { type: "button", text: "See the results", url: facts.url },
    ],
  };
}
