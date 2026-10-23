import { countWords, fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import {
  staffEmailsEn,
  type StaffEmailsMessages,
} from "./admin-messages/staff-emails.en";
import type { EmailContent } from "./email-layout";

/**
 * The email an A/B test's guardrail sends the store's owners when it stops a test by itself (D148, phase 6). Pure: the figures
 * are counted in code (`experimentResults()`), the sentences here only put them in words. It is written in each owner's admin language (D312 A10).
 * It says what happened and what the owner may do, never why: the figures do not say why a version did worse.
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

const number = (n: number, locale: string) => n.toLocaleString(locale);

/** Orders per hundred visitors, as the owner reads it: `2.6 %` (`2,6 %` in Norwegian). */
export function orderRate(
  buyers: number,
  visitors: number,
  locale = "en-GB",
): string {
  if (visitors <= 0) return "0 %";
  const rate = (buyers / visitors) * 100;
  return `${rate.toLocaleString(locale, { maximumFractionDigits: rate < 10 ? 1 : 0 })} %`;
}

/** Written from the `staffEmails` catalogue in the recipient's admin language (D312 A10); English unless other words are given. */
export function guardrailEmail(
  facts: GuardrailFacts,
  words: StaffEmailsMessages = staffEmailsEn,
  lang: AdminLang = "en",
): EmailContent {
  const { version, original } = facts;
  const w = words.guardrail;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const letter = version.key.toUpperCase();
  const figures = fillWords(w.figures, {
    vBuyers: number(version.buyers, locale),
    vVisitors: number(version.visitors, locale),
    letter,
    vRate: orderRate(version.buyers, version.visitors, locale),
    oBuyers: number(original.buyers, locale),
    oVisitors: number(original.visitors, locale),
    oRate: orderRate(original.buyers, original.visitors, locale),
  });
  return {
    subject: fillWords(w.subject, { test: facts.testName, letter }),
    preview: fillWords(w.preview, { letter }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [facts.storeName, words.footer],
    blocks: [
      { type: "heading", text: w.heading },
      {
        type: "paragraph",
        text: fillWords(w.stopped, {
          test: facts.testName,
          target: facts.target,
          store: facts.storeName,
          days: countWords(facts.days, w.days),
          letter,
          version: version.name,
        }),
      },
      { type: "paragraph", text: figures },
      { type: "paragraph", text: w.nobodyNew },
      { type: "paragraph", text: w.openResults },
      { type: "button", text: w.button, url: facts.url },
    ],
  };
}
