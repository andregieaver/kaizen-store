import { z } from "zod";

import { countWords, fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import { staffEmailsEn, type StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import { findClaims } from "./claims";
import type { EmailBlock, EmailContent } from "./email-layout";

/**
 * The autopilot's daily digest and weekly report (D309, `docs/ai-autopilot.md` 7.5), pure: the facts code gathered, the email made from them in
 * the person's admin language, and the check a model's few sentences must pass to be kept. What reaches the email is counts, the plans' own
 * step titles, money written by `formatMoney()` and goals' titles: never a customer, a step's result or anything a customer wrote.
 */

export const STEPS_LISTED = 8;
export const NOTE_MAX = 600;

export const reportFactsSchema = z.object({
  kind: z.enum(["daily", "weekly"]),
  store: z.string().nullable(),
  stepsDone: z.array(z.string()).max(STEPS_LISTED),
  stepsDoneCount: z.number().int().min(0),
  waiting: z.number().int().min(0),
  /** Weekly: net sales of the last 7 store days and the 7 before, written in the main currency; null when not measured. */
  sales: z.object({ now: z.string().nullable(), before: z.string().nullable() }).optional(),
  orders: z.object({ now: z.number().int().nullable(), before: z.number().int().nullable() }).optional(),
  goals: z.array(z.object({ title: z.string(), met: z.number().int(), all: z.number().int() })).optional(),
});
export type ReportFacts = z.infer<typeof reportFactsSchema>;

/** Whether a digest has anything to say: a step finished or something waiting. */
export const digestWorthSending = (facts: Pick<ReportFacts, "stepsDoneCount" | "waiting">) => facts.stepsDoneCount > 0 || facts.waiting > 0;

/**
 * A model's few sentences for the weekly report, kept only when they say no figure of their own (no digit), make no claim the filter finds and
 * are short; otherwise null and the report goes without them.
 */
export function checkedNote(text: string): string | null {
  const note = text.replace(/\s+/g, " ").trim();
  if (!note || note.length > NOTE_MAX) return null;
  if (/\d/.test(note)) return null;
  if (findClaims(note).length > 0) return null;
  return note;
}

export function autopilotEmail(
  facts: ReportFacts,
  url: string,
  note: string | null,
  words: StaffEmailsMessages = staffEmailsEn,
  lang: AdminLang = "en",
): EmailContent {
  const w = words.autopilot;
  const where = facts.store ? fillWords(w.where, { store: facts.store }) : "";
  const base = { lang: ADMIN_LANG_FACTS[lang].tag, footer: [words.footer] };
  const steps: EmailBlock[] =
    facts.stepsDoneCount > 0
      ? [
          { type: "paragraph", text: countWords(facts.stepsDoneCount, w.done, { n: facts.stepsDoneCount }) },
          { type: "lines", rows: facts.stepsDone.map((title) => ({ label: title, value: "" })) },
        ]
      : [{ type: "paragraph", text: w.noneDone }];
  const waiting: EmailBlock[] = facts.waiting > 0 ? [{ type: "paragraph", text: countWords(facts.waiting, w.waiting, { n: facts.waiting }) }] : [];
  const button: EmailBlock = { type: "button", text: w.button, url };
  if (facts.kind === "daily") {
    return {
      ...base,
      subject: fillWords(w.digestSubject, { where }),
      preview: fillWords(w.digestPreview, { done: facts.stepsDoneCount, waiting: facts.waiting }),
      blocks: [{ type: "heading", text: w.digestHeading }, ...steps, ...waiting, button],
    };
  }
  const figure = (now: string | number | null, before: string | number | null) =>
    now === null ? w.notMeasured : before === null ? String(now) : fillWords(w.salesBefore, { now: String(now), before: String(before) });
  const lines = [
    ...(facts.sales ? [{ label: w.sales, value: figure(facts.sales.now, facts.sales.before) }] : []),
    ...(facts.orders ? [{ label: w.orders, value: figure(facts.orders.now, facts.orders.before) }] : []),
    { label: w.stepsWeek, value: String(facts.stepsDoneCount) },
  ];
  return {
    ...base,
    subject: fillWords(w.weeklySubject, { where }),
    preview: w.weeklyPreview,
    blocks: [
      { type: "heading", text: w.weeklyHeading },
      { type: "lines", rows: lines },
      ...(facts.goals?.length
        ? [
            { type: "paragraph" as const, text: w.goals },
            { type: "lines" as const, rows: facts.goals.map((g) => ({ label: g.title, value: fillWords(w.goalLine, { met: g.met, all: g.all }) })) },
          ]
        : []),
      ...waiting,
      ...(note ? [{ type: "paragraph" as const, text: `${w.note}: ${note}` }] : []),
      button,
    ],
  };
}
