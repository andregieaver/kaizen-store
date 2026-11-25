/**
 * The social media adviser's weekly review (D870 S1.5, `docs/social-manager.md` 4): what the store's posts did in the week, against the
 * week before, the adviser's newest verdicts and the posts it planned for the coming week, for the owner's inbox. Every figure is code's;
 * the only words from a model are the verdicts and plans, checked when the advice was written (`parseAdvice()`). Pure.
 */

import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import type { StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import type { EmailBlock, EmailContent } from "./email-layout";
import { CHANNEL_SPECS, type PostChannel } from "./social-posts";

/** The review is sent from this hour on the store's Monday (or any later day of the week, once). */
export const REVIEW_HOUR = 8;
/** Only for people who asked the adviser within this many days: asking is the opt-in, and the review stops when they stop. */
export const REVIEW_ACTIVE_DAYS = 60;

export type WeekFigures = { visits: number; orders: number; revenueMinor: number };

export type ReviewFacts = {
  store: string;
  currency: string;
  weekStart: string;
  posts: { written: number; copied: number };
  /** Visits, orders and sales from tagged posts; null where the store does not count visits. */
  tagged: { week: WeekFigures; before: WeekFigures } | null;
  instagram: { posts: number; bestReach: number | null } | null;
  /** The Facebook Page's posts of the week (S1.2b); null without a chosen Page. */
  facebook?: { posts: number; bestReach: number | null } | null;
  advice: { date: string; verdicts: string[]; planned: { day: string; channel: PostChannel; idea: string }[] } | null;
};

/** Whether the week has anything to say: a post written, a tagged visit, an Instagram or Facebook post or advice to show. */
export const reviewWorthSending = (facts: ReviewFacts): boolean =>
  facts.posts.written > 0 ||
  (facts.tagged !== null && facts.tagged.week.visits > 0) ||
  (facts.instagram?.posts ?? 0) > 0 ||
  (facts.facebook?.posts ?? 0) > 0 ||
  facts.advice !== null;

export function socialReviewEmail(
  facts: ReviewFacts,
  url: string,
  words: StaffEmailsMessages,
  lang: AdminLang,
  money: (minor: number) => string,
): EmailContent {
  const w = words.social;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const n = (v: number) => v.toLocaleString(locale);
  const versus = (now: string, before: string) => fillWords(w.before, { now, before });
  const t = facts.tagged;
  const rows = [
    { label: w.written, value: n(facts.posts.written) },
    { label: w.copied, value: n(facts.posts.copied) },
    ...(t
      ? [
          { label: w.visits, value: versus(n(t.week.visits), n(t.before.visits)) },
          { label: w.orders, value: versus(n(t.week.orders), n(t.before.orders)) },
          { label: w.sales, value: versus(money(t.week.revenueMinor), money(t.before.revenueMinor)) },
        ]
      : [{ label: w.visits, value: w.notCounted }]),
    ...(facts.instagram
      ? [
          { label: w.instagram, value: n(facts.instagram.posts) },
          ...(facts.instagram.bestReach !== null ? [{ label: w.bestReach, value: n(facts.instagram.bestReach) }] : []),
        ]
      : []),
    ...(facts.facebook
      ? [
          { label: w.facebook, value: n(facts.facebook.posts) },
          ...(facts.facebook.bestReach !== null ? [{ label: w.facebookBest, value: n(facts.facebook.bestReach) }] : []),
        ]
      : []),
  ];
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const advice: EmailBlock[] = facts.advice
    ? [
        { type: "paragraph", text: fillWords(w.verdicts, { date: day(facts.advice.date) }) },
        { type: "lines", rows: facts.advice.verdicts.map((v) => ({ label: v, value: "" })) },
        ...(facts.advice.planned.length > 0
          ? [
              { type: "paragraph" as const, text: w.planned },
              { type: "lines" as const, rows: facts.advice.planned.map((p) => ({ label: `${day(p.day)} · ${CHANNEL_SPECS[p.channel].label}`, value: p.idea })) },
            ]
          : []),
      ]
    : [];
  return {
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [words.footer],
    subject: fillWords(w.subject, { store: facts.store }),
    preview: w.preview,
    blocks: [{ type: "heading", text: w.heading }, { type: "lines", rows }, ...advice, { type: "button", text: w.button, url }],
  };
}
