import type { FlowsMessages } from "./admin-messages/flows.en";
import type { FlowStep } from "./flows";
import { languageName } from "./localization";

/**
 * Checks before a flow is switched on (D767, email plan M3.6), in code: each a line naming the email and what to do. A blocking one keeps the
 * flow off: an email not written in the store's first language sends nothing to a reader whose own is missing (`languageFor()`), and a
 * language half written is refused as a broadcast's is (`sendProblems()`). The rest only warn. Links need no check: an address is refused when
 * it is saved (`isBroadcastAddress()`). Pure: the page and the switch both read it.
 */

export type FlowCheck = {
  stepId: string;
  subject: string;
  kind: "main_missing" | "half_written" | "picture_alt" | "picture_format" | "too_big";
  /** The language it is about, where it is one. */
  locale: string | null;
  blocking: boolean;
};

/** Gmail clips an email past this many bytes of HTML; the words here are a part of that, so a quarter of it already warns. */
export const CLIP_BYTES = 102 * 1024;
const WORDS_WARN_BYTES = CLIP_BYTES / 4;

/** Picture formats many mail apps do not show (Outlook among them). */
const UNSHOWN = /\.(webp|avif|svg|heic)(\?|#|$)/i;

function* emails(steps: readonly FlowStep[]): Generator<Extract<FlowStep, { kind: "email" }>> {
  for (const step of steps) {
    if (step.kind === "email") yield step;
    if (step.kind === "if") {
      yield* emails(step.then);
      yield* emails(step.else);
    }
  }
}

export function flowChecks(steps: readonly FlowStep[], main: string): FlowCheck[] {
  const out: FlowCheck[] = [];
  for (const step of emails(steps)) {
    const subject = step.content[main]?.subject || Object.values(step.content)[0]?.subject || step.id;
    const add = (kind: FlowCheck["kind"], locale: string | null, blocking: boolean) => out.push({ stepId: step.id, subject, kind, locale, blocking });
    const first = step.content[main];
    if (!first?.subject || first.blocks.length === 0) add("main_missing", main, true);
    for (const [locale, c] of Object.entries(step.content)) {
      if (locale !== main && Boolean(c.subject) !== c.blocks.length > 0) add("half_written", locale, true);
      for (const block of c.blocks) {
        if (block.type !== "image") continue;
        if (!block.alt.trim()) add("picture_alt", locale, false);
        if (UNSHOWN.test(block.url)) add("picture_format", locale, false);
      }
      if (new TextEncoder().encode(JSON.stringify(c)).length > WORDS_WARN_BYTES) add("too_big", locale, false);
    }
  }
  return out;
}

/** A check as the owner reads it, in the admin's words (`w.checks`). */
export function checkWords(w: FlowsMessages, check: FlowCheck): string {
  return w.checks[check.kind].replace("{subject}", check.subject).replace("{language}", check.locale ? languageName(check.locale) : "");
}
