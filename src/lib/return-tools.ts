import { STATUS_LABELS } from "./return-admin";
import { canMove, type ReturnKind, type ReturnStatus } from "./return-status";

/**
 * What the AI manager's returns tools (D153) may do, decided without a database: `list_returns` and `explain_return` only read,
 * `approve_return` and `decline_return` answer a voluntary return the store has not yet answered and email the shopper, and
 * nothing here refunds: refunding stays a screen action (the return's page shows the working), as does everything that follows
 * the answer. A withdrawal is the shopper's legal right: it is never declined by the assistant, and the database refuses it too.
 */

export type ReturnRef = { number: string; kind: ReturnKind; status: ReturnStatus };

/** Why a return cannot be approved by the assistant, in a sentence for the model; null when it can. */
export function approveProblem(r: ReturnRef): string | null {
  if (r.kind === "withdrawal") {
    return `Return ${r.number} is a withdrawal: it was approved when the customer confirmed it, because the right of withdrawal is not the store's to refuse. What follows (instructions, receiving, refunding) is done on its page.`;
  }
  if (r.status === "requested") return null;
  if (canMove(r.kind, r.status, "approved")) return null;
  return `Return ${r.number} is ${STATUS_LABELS[r.status].toLowerCase()}, so it cannot be approved: only a return request that waits for an answer can.`;
}

/** Why a return cannot be declined by the assistant, in a sentence for the model; null when it can. */
export function declineProblem(r: ReturnRef): string | null {
  if (r.kind === "withdrawal") {
    return `Return ${r.number} is a withdrawal, the customer's legal right inside the withdrawal period, so it cannot be declined. Only a line the law excludes from the right can be declined, on the return's page.`;
  }
  if (canMove(r.kind, r.status, "declined")) return null;
  return `Return ${r.number} is ${STATUS_LABELS[r.status].toLowerCase()}, so it cannot be declined: only a return request that waits for an answer can.`;
}

/** What the assistant says about the part it does not do. */
export const REFUND_ON_SCREEN =
  "Refunding is done on the return's page, where the working is shown before the button: the assistant does not refund returns.";

/** The words a gated call is kept with, for the owner's yes. */
export function approveSummary(number: string, instructions: string | null): string {
  return `Approve the return ${number} and email the customer how to send the goods back${instructions ? `, with your instructions: "${instructions}"` : ""}.`;
}

export function declineSummary(number: string, reason: string): string {
  return `Decline the return ${number} and email the customer why: "${reason}"`;
}
