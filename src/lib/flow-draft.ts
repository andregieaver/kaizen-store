import type { FlowCondition, FlowGoal, FlowStep } from "./flows";

/**
 * A flow as the AI manager drafts it from the owner's sentence (email plan M3.2), turned into the flows engine's steps by code, never by the
 * model: each email after its days, in an `if` when it is only for some, in the store's first language. Pure.
 */

export type DraftEmail = { after_days: number; subject: string; text: string; only_if?: "has_ordered" | "has_not_ordered" | "pressed_a_link" | "pressed_no_link" };

const CONDITIONS: Record<NonNullable<DraftEmail["only_if"]>, { condition: FlowCondition; yes: boolean }> = {
  has_ordered: { condition: { kind: "ordered_since_entry" }, yes: true },
  has_not_ordered: { condition: { kind: "ordered_since_entry" }, yes: false },
  pressed_a_link: { condition: { kind: "clicked_flow_email" }, yes: true },
  pressed_no_link: { condition: { kind: "clicked_flow_email" }, yes: false },
};

/** The steps of a drafted flow: a wait before each email that comes days later, each email's paragraphs split by a blank line. */
export function draftSteps(emails: readonly DraftEmail[], locale: string): FlowStep[] {
  const steps: FlowStep[] = [];
  emails.forEach((e, i) => {
    const n = i + 1;
    if (e.after_days > 0) steps.push({ id: `wait-${n}`, kind: "wait", hours: e.after_days * 24 });
    const paragraphs = e.text.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
    const email: FlowStep = {
      id: `email-${n}`,
      kind: "email",
      content: { [locale]: { subject: e.subject, preview: "", blocks: paragraphs.map((text) => ({ type: "paragraph" as const, text })) } },
    };
    if (!e.only_if) {
      steps.push(email);
      return;
    }
    const { condition, yes } = CONDITIONS[e.only_if];
    steps.push({ id: `if-${n}`, kind: "if", condition, then: yes ? [email] : [], else: yes ? [] : [email] });
  });
  return steps;
}

/** A drafted flow's goals: ended by an order when the owner meant it to bring one. */
export const draftGoals = (endsOnOrder: boolean | undefined): FlowGoal[] => (endsOnOrder ? [{ kind: "ordered" }] : []);

/** Every word a drafted flow's emails say, for the claims check. */
export const draftWords = (emails: readonly DraftEmail[]): string => emails.flatMap((e) => [e.subject, e.text]).join("\n");
