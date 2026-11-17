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
  /**
   * Which guardrail stopped it (D148 phase 19), with what it counted per version (page loads and the slow ones, checkouts and the failed
   * payments); without it, orders, as `version` and `original` say.
   */
  guardrail?: { kind: "speed" | "checkout"; version: { n: number; bad: number }; original: { n: number; bad: number } };
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
  const other = facts.guardrail ? { ...w[facts.guardrail.kind], counted: facts.guardrail } : null;
  const figures = other
    ? fillWords(other.figures, {
        vBad: number(other.counted.version.bad, locale),
        vN: number(other.counted.version.n, locale),
        letter,
        vRate: orderRate(other.counted.version.bad, other.counted.version.n, locale),
        oBad: number(other.counted.original.bad, locale),
        oN: number(other.counted.original.n, locale),
        oRate: orderRate(other.counted.original.bad, other.counted.original.n, locale),
      })
    : fillWords(w.figures, {
        vBuyers: number(version.buyers, locale),
        vVisitors: number(version.visitors, locale),
        letter,
        vRate: orderRate(version.buyers, version.visitors, locale),
        oBuyers: number(original.buyers, locale),
        oVisitors: number(original.visitors, locale),
        oRate: orderRate(original.buyers, original.visitors, locale),
      });
  return {
    subject: fillWords((other ?? w).subject, { test: facts.testName, letter }),
    preview: fillWords((other ?? w).preview, { letter }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [facts.storeName, words.footer],
    blocks: [
      { type: "heading", text: w.heading },
      {
        type: "paragraph",
        text: fillWords((other ?? w).stopped, {
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

/** What the "has an answer" email says (D662): the verdict as the test's page words it, in the reader's language. */
export type AnsweredFacts = {
  storeName: string;
  testName: string;
  target: string;
  /** The verdict's headline and detail (`verdictOf()`), already in the reader's language. */
  headline: string;
  detail: string;
  days: number;
  url: string;
};

/** The email to a test's owners the first time it has an answer (D662): what it found, and that deciding is theirs. */
export function answeredEmail(facts: AnsweredFacts, words: StaffEmailsMessages = staffEmailsEn, lang: AdminLang = "en"): EmailContent {
  const w = words.answered;
  return {
    subject: fillWords(w.subject, { test: facts.testName }),
    preview: fillWords(w.preview, { headline: facts.headline }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [facts.storeName, words.footer],
    blocks: [
      { type: "heading", text: w.heading },
      { type: "paragraph", text: fillWords(w.intro, { test: facts.testName, target: facts.target, store: facts.storeName, days: countWords(facts.days, w.days) }) },
      { type: "paragraph", text: `${facts.headline} ${facts.detail}` },
      { type: "paragraph", text: w.decide },
      { type: "button", text: w.button, url: facts.url },
    ],
  };
}
