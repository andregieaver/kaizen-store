import { z } from "zod";

import type { ChatReply } from "./chat";
import { withoutSecrets } from "./docs-guide-shape";
import { DOCUMENT_TITLE_MAX } from "./knowledge";

/**
 * Questions the assistant could not answer (ecosystem plan E4.3, D729), the pure parts: when a chat turn counts as one, what of the
 * visitor's words is kept, how repeats are grouped, and what the owner's answer becomes. The site's chat (D81) answers from its
 * knowledge (`searchKnowledge()`); a question it could not answer goes to the gap list (`commerce.unanswered_questions`), where the owner
 * writes the answer once and it is saved as a knowledge document, so the chat uses it the next time. As the docs' gap list (D443, D444)
 * does for the docs, but per site, with a link to the conversation, and for the owner to answer.
 *
 * A visitor's words are personal data and untrusted text: they are kept cut and masked (`questionText()`), shown as text, never sent to a
 * model as instructions and never emailed; kept at most `QUESTION_KEEP_DAYS` after they were last asked.
 */

/** The longest question kept, in characters: enough to read what was asked, not a whole message. */
export const QUESTION_MAX = 300;
/** The fewest letters a question must have to be kept ("?" or "ok" is no question). */
export const QUESTION_MIN_LETTERS = 3;
/** The conversations kept with a question for the owner to read (Lisa), the newest first. */
export const QUESTION_CONVERSATIONS = 5;
/** Questions a site keeps at most; past it a new question is not added (one already kept is still counted). */
export const QUESTIONS_KEPT_MAX = 500;
/** Days a question is kept after it was last asked (the retention rule `unanswered_questions`, a test holds them equal). */
export const QUESTION_KEEP_DAYS = 90;
/** The longest answer the owner writes here: a short knowledge document. */
export const ANSWER_MAX = 4000;

export const QUESTION_STATUSES = ["open", "answered", "dismissed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/**
 * Why a turn counts as not answered, from what the code saw, never from the model's wording: the AI handed the conversation to a person
 * because it could not help (`handoff_to_human` with `could_not_help`, D216 with the AI first), or every tool the answer used was the
 * knowledge search and none found a passage (`ChatReply.foundNothing`).
 */
export const GAP_SIGNALS = ["handoff", "knowledge"] as const;
export type GapSignal = (typeof GAP_SIGNALS)[number];

/** Whether a chat answer is one the gap list keeps, and why; null for an answer that stood on something. */
export function gapOf(reply: Pick<ChatReply, "handoff" | "escalation" | "foundNothing">): GapSignal | null {
  if (reply.handoff && reply.escalation === "could_not_help") return "handoff";
  if (reply.foundNothing) return "knowledge";
  return null;
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
/** A run of digits with spaces, dots or dashes between; it is taken out when it holds `NUMBER_DIGITS` digits or more. */
const NUMBER = /\+?\d[\d\s().-]*\d/g;
/** A phone number, an order or card number, an account number: six digits or more ("10 to 20 days" and a year stay). */
const NUMBER_DIGITS = 6;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/** What stands where a person's details were taken out of a kept question. */
export const MASK = { email: "[email]", number: "[number]", link: "[link]" } as const;

/**
 * What is kept of a visitor's question: every secret, email address, long number and web address taken out (each marked), spaces made
 * one, cut at a word to `QUESTION_MAX`; null when too little is left to be a question. Shown as text only.
 */
export function questionText(raw: string): string | null {
  const plain = withoutSecrets(raw.normalize("NFKC"))
    .text.replace(URL, MASK.link)
    .replace(EMAIL, MASK.email)
    .replace(NUMBER, (run) => ((run.match(/\d/g) ?? []).length >= NUMBER_DIGITS ? MASK.number : run))
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // The letters the visitor wrote, the marks left out: a message that was only an address or a number is no question.
  const own = Object.values(MASK).reduce((text, mark) => text.split(mark).join(" "), plain);
  if ((own.match(/\p{L}/gu) ?? []).length < QUESTION_MIN_LETTERS) return null;
  if (plain.length <= QUESTION_MAX) return plain;
  const cut = plain.slice(0, QUESTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > QUESTION_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The key repeats are grouped under: the kept text in lower case, letters and digits only, spaces made one. "Do you ship to Iceland?" and
 * "do you ship to iceland" are one question; another wording is another (no model is asked per question to compare meanings).
 */
export function questionKey(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, QUESTION_MAX);
}

/** The knowledge document's title proposed for a question: the question itself, cut to a document title's length. */
export function answerTitle(question: string): string {
  const one = question.replace(/\s+/g, " ").trim();
  return one.length <= DOCUMENT_TITLE_MAX ? one : `${one.slice(0, DOCUMENT_TITLE_MAX - 1).trimEnd()}…`;
}

/** What the owner sends with *Write the answer*: the answer, and the document's title (empty: the question, `answerTitle()`). */
export const answerInput = z.object({
  title: z.string().trim().max(DOCUMENT_TITLE_MAX).default(""),
  answer: z.string().trim().min(1).max(ANSWER_MAX),
});
export type AnswerInput = z.infer<typeof answerInput>;

/** A question as the owner's screen shows it: the words kept, how often and when, and where it came from. */
export type UnansweredQuestion = {
  id: string;
  question: string;
  lang: string;
  asked: number;
  /** How many of the times it was asked the AI handed the conversation to a person (the rest: the knowledge had nothing). */
  handedOver: number;
  status: QuestionStatus;
  firstAt: string;
  lastAt: string;
  /** The knowledge document the owner's answer was saved as, while it exists. */
  documentId: string | null;
  /** The conversations it came from that still have their transcript, the newest first. */
  conversations: { id: string; at: string }[];
};
