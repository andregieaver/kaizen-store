/**
 * The vision check of a social post's picture (D870 S2.3, `docs/social-manager.md` 5): before a post is approved, the store's model that
 * sees pictures looks at the picture as it will be posted and says whether its words can be read, whether it shows what the post is about,
 * whether anything is cut off, and whether it looks like the shop. The answer is a JSON object read by its shape; what is wrong is a fixed
 * list, and the note is a sentence shown to the owner as text. Pure; the server is `src/server/social-vision.ts`.
 */

import { UNTRUSTED_TEXT } from "./prompt-safety";
import { CHANNEL_SPECS, type PostChannel } from "./social-posts";

/** What the check can find wrong with a picture. */
export const CHECK_PROBLEMS = ["unreadable", "wrong_subject", "cut_off", "off_brand"] as const;
export type CheckProblem = (typeof CHECK_PROBLEMS)[number];

/** The longest note kept. */
export const CHECK_NOTE_MAX = 200;

export type CheckSubject = { kind: "product" | "page" | "topic"; title: string; about: string };

export type CheckVerdict = { problems: CheckProblem[]; note: string };

const clean = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

/** The question to the model: the post's channel and shape, what the post is about and the shop's colours, the picture beside it. */
export function visionPrompt(input: { shop: string; channel: PostChannel; shape: string; subject: CheckSubject; colours: string[] }): { system: string; user: string } {
  const subject =
    input.subject.kind === "topic"
      ? `The post is about a topic of the shop's own: ${JSON.stringify(clean(input.subject.title, 200))}. Nothing in particular has to be shown.`
      : `The post is about the ${input.subject.kind} ${JSON.stringify(clean(input.subject.title, 120))}: ${JSON.stringify(clean(input.subject.about, 400))}.`;
  return {
    system: [
      `You are the picture checker for the shop "${input.shop}". You look at one picture made for a ${CHANNEL_SPECS[input.channel].label} post (${input.shape}) before a person approves it.`,
      "Say only what you see. Judge four things:",
      '"readable": every word on the picture can be read at the size it will be seen, against what is behind it.',
      '"shows_subject": the picture shows what the post is about (for a topic, answer true).',
      '"whole": nothing that matters is cut off at an edge (a word, the product, a face).',
      `"on_brand": it fits the shop's look, its colours ${input.colours.map((c) => JSON.stringify(c)).join(", ") || "as given"} and a calm, tidy layout.`,
      `Answer with one JSON object and nothing else: {"readable": boolean, "shows_subject": boolean, "whole": boolean, "on_brand": boolean, "note": string}. The note is one short sentence (under ${CHECK_NOTE_MAX} characters) saying what is wrong, or empty when nothing is. Never write a price, a number or a claim in the note.`,
      UNTRUSTED_TEXT,
    ].join(" "),
    user: subject,
  };
}

const PROBLEM_OF: Record<string, CheckProblem> = { readable: "unreadable", shows_subject: "wrong_subject", whole: "cut_off", on_brand: "off_brand" };

/**
 * The model's answer as a verdict, or null when it is no JSON object with the four answers. An answer the model leaves out counts as a pass
 * only for `shows_subject` on a topic; a note is kept only when something was found, without digits (a figure is never the model's to say).
 */
export function parseVisionVerdict(answer: string, subject: CheckSubject["kind"]): CheckVerdict | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const problems: CheckProblem[] = [];
  for (const [key, problem] of Object.entries(PROBLEM_OF)) {
    const value = data[key];
    if (key === "shows_subject" && subject === "topic") continue;
    if (typeof value !== "boolean") return null;
    if (!value) problems.push(problem);
  }
  const note = typeof data.note === "string" && problems.length > 0 ? clean(data.note, CHECK_NOTE_MAX) : "";
  return { problems, note: /\d/.test(note) ? "" : note };
}

/** Whether a checked post failed: something found wrong. An unchecked post has not failed. */
export const checkFailed = (problems: readonly string[] | undefined): boolean => (problems?.length ?? 0) > 0;
