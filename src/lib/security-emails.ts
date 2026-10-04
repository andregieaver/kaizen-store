import type { EmailContent } from "./email-layout";

/**
 * The emails about a person's own sign-in security (wave 1, 1f, docs/wave-1-trust.md 2.6): a recovery code was used, two-step was
 * removed, a platform admin reset it. Pure, like `experiment-emails.ts`: the server decides who gets one and when. Kaizen writes to
 * its staff in English, as the admin is. Each says what happened and what to do if it was not them, and none carries a code, a link
 * that signs anyone in, or a secret.
 */

export type SecurityEvent = "recovery_code_used" | "two_step_removed" | "two_step_reset";

export type SecurityFacts = {
  event: SecurityEvent;
  /** The person's name or email, for the greeting. */
  person: string;
  /** When it happened, as the reader reads it (`2026-10-03 14:05 UTC`). */
  when: string;
  /** For a recovery code: how many are still unused after this. Left out for the others. */
  codesLeft?: number;
  /** For a reset: who did it (a platform admin's email). */
  by?: string | null;
  /** The sign-in page. */
  signInUrl: string;
};

const FOOTER = ["Kaizen · kaizenstore.cloud"];

export function securityEmail(facts: SecurityFacts): EmailContent {
  const intro =
    facts.event === "recovery_code_used"
      ? `A recovery code was used to get into your Kaizen account on ${facts.when}. Using a recovery code takes your two-step sign-in away, so you are asked to set it up again the next time you sign in, and your other recovery codes no longer work.`
      : facts.event === "two_step_removed"
        ? `Two-step sign-in was switched off for your Kaizen account on ${facts.when}.`
        : `A platform admin${facts.by ? ` (${facts.by})` : ""} reset the two-step sign-in of your Kaizen account on ${facts.when}. You are asked to set it up again the next time you sign in.`;
  const subject =
    facts.event === "recovery_code_used"
      ? "A recovery code was used on your account"
      : facts.event === "two_step_removed"
        ? "Two-step sign-in was switched off on your account"
        : "Your two-step sign-in was reset";
  return {
    subject,
    preview: subject,
    lang: "en",
    footer: FOOTER,
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `Hello ${facts.person},` },
      { type: "paragraph", text: intro },
      { type: "paragraph", text: "If this was you, there is nothing more to do." },
      {
        type: "paragraph",
        text: "If it was not you, someone else may have access to your account. Sign in, change your password at once and set up two-step sign-in again, then tell the owner of your store.",
      },
      { type: "button", text: "Sign in", url: facts.signInUrl },
    ],
  };
}
