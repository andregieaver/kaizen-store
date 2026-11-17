import { z } from "zod";

/**
 * The AI manager's contract tools (D695 step 4, `docs/contracts.md` 7): what they take and what the owner is asked to approve. Pure; the
 * runners are `src/server/contract-tools.ts`. Sending a draft for signing is never a tool: it draws the contract's PDF, which only the
 * contract's page does, so the manager makes the draft and gives its page, where the owner reads it and presses Send for signing.
 */

const dealRef = z.string().trim().min(1).max(200).describe("The deal: its title as list_contracts or the Deals board shows it (a part of it is enough when only one deal has it), or its id.");
const contractRef = z.string().trim().min(1).max(200).describe("The contract: its id as list_contracts gives it.");

export const CONTRACT_LIST_STATUSES = ["open", "draft", "sent", "signed", "declined", "expired", "cancelled", "all"] as const;

export const listContractsInput = z.object({
  deal: dealRef.optional().describe("Only this deal's contracts (its title, or a part of it, or its id). Left out: the store's contracts."),
  status: z
    .enum(CONTRACT_LIST_STATUSES)
    .default("open")
    .describe("open (the default): drafts and contracts out for signing; draft, sent, signed, declined, expired or cancelled; all: every one, newest first."),
});
export type ListContractsInput = z.output<typeof listContractsInput>;

export const draftContractInput = z.object({
  deal: dealRef,
  template: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("The template's name, as list_contracts lists them. Left out: the store's first template."),
});
export type DraftContractInput = z.output<typeof draftContractInput>;

export const remindContractSignerInput = z.object({ contract: contractRef });
export type RemindContractSignerInput = z.output<typeof remindContractSignerInput>;

/** A text as one short line for a card: line breaks and control characters out, cut with an ellipsis. */
const line = (value: unknown, max: number): string => {
  const text = String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The card for a reminder, from the contract and signer the server read (`remindApprovalWords()`), never the model's words. */
export function remindSummary(found: { title: string; signer: string; role: "store" | "customer" | "other" } | null, given: Record<string, unknown>): string {
  if (!found) return `Email the next signer of contract ${line(given.contract, 60)} a reminder to sign.`;
  const who = found.role === "store" ? `${line(found.signer, 80)} (signs for the store)` : line(found.signer, 80);
  return `Email ${who} a reminder to sign "${line(found.title, 120)}", with their link to the signing page.`;
}
