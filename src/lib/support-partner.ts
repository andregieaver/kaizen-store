import { cleanReply } from "./chat";
import type { OwnerToolName } from "./owner-tools";
import { TOOL_PERMISSIONS } from "./owner-tool-permissions";
import { can, type PermissionHolder } from "./permissions";
import { firstJsonObject } from "./support-summary";
import {
  PARTNER_ANSWER_MAX,
  PARTNER_DRAFT_MAX,
  PARTNER_FACTS_MAX,
  PARTNER_RECOMMENDATION_MAX,
  type Handler,
  type SupportMode,
} from "./support-rules";

/**
 * The silent partner (D216, `docs/support.md` 2.5, 4.3b): the AI beside an agent, seen only by staff. It reads with the agent's
 * own permissions, through the AI manager's read-only tools run by `runOwnerTool()` (so `TOOL_PERMISSIONS` and `TOOL_FEATURES`
 * apply as they do there) and two tools of its own; it never acts and never writes to the customer. What it answers is used only
 * when it parses: facts must name a tool it really called this turn, every field is cut to its length, and a draft passes
 * `cleanReply()` like every AI text a customer may read.
 */

/** The AI manager's tools the partner may use: each reads, none is gated (`support-partner.test.ts` holds both). */
export const PARTNER_OWNER_TOOLS = [
  "get_order",
  "list_orders",
  "list_returns",
  "explain_return",
  "list_subscriptions",
  "subscription_boxes",
  "list_emails",
  "list_invoices",
  "list_bookings",
  "get_customer",
  "list_customers",
  "list_products",
  "get_product",
  "stock_levels",
  "list_discounts",
  "list_campaigns",
  "get_bonus_program",
] as const satisfies readonly OwnerToolName[];

/** The partner's own tools: the chat's knowledge and store facts, who the customer is, and their earlier conversations. */
export const PARTNER_OWN_TOOLS = ["search_content", "store_info", "conversation_facts", "earlier_conversations"] as const;

export type PartnerTool = (typeof PARTNER_OWNER_TOOLS)[number] | (typeof PARTNER_OWN_TOOLS)[number];

/** The tools the partner may use for an agent: the owner tools their role may read, and its own (the agent reached the inbox). */
export function partnerToolsFor(holder: PermissionHolder): PartnerTool[] {
  return [...PARTNER_OWNER_TOOLS.filter((name) => can(holder, TOOL_PERMISSIONS[name])), ...PARTNER_OWN_TOOLS];
}

/**
 * Whether the partner runs by itself for a conversation (after a customer message, or a take-over): the desk's switch, the
 * agent's own, not paused here, a text model, support on, and the agent has the conversation.
 */
export function partnerMayRun(input: {
  mode: SupportMode;
  deskPartner: boolean;
  agentPartner: boolean;
  paused: boolean;
  hasModel: boolean;
  handler: Handler;
  assigneeIsAgent: boolean;
}): boolean {
  return (
    input.mode !== "off" &&
    input.deskPartner &&
    input.agentPartner &&
    !input.paused &&
    input.hasModel &&
    input.handler === "human" &&
    input.assigneeIsAgent
  );
}

export type PartnerFact = { text: string; tool: string };
export type PartnerAnswer = { facts: PartnerFact[]; recommendation: string | null; draft: string | null; answer: string | null };

const FACT_MAX = 300;

const words = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * The partner's answer, or null when it holds nothing usable. `called` is the tools it really called this turn: a fact naming
 * another is dropped. The draft goes through `cleanReply()` (claims, links and Markdown out); one with nothing left is dropped.
 */
export function parsePartner(raw: string, called: readonly string[]): PartnerAnswer | null {
  const value = firstJsonObject(raw);
  if (!value) return null;
  const facts = (Array.isArray(value.facts) ? value.facts : [])
    .map((f): PartnerFact | null => {
      if (typeof f !== "object" || f === null) return null;
      const { text, tool } = f as { text?: unknown; tool?: unknown };
      const fact = words(text, FACT_MAX);
      return fact && typeof tool === "string" && called.includes(tool) ? { text: fact, tool } : null;
    })
    .filter((f): f is PartnerFact => f !== null)
    .slice(0, PARTNER_FACTS_MAX);
  const recommendation = words(value.recommendation, PARTNER_RECOMMENDATION_MAX);
  const rawDraft = words(value.draft, PARTNER_DRAFT_MAX);
  const draft = rawDraft ? cleanReply(rawDraft, "") || null : null;
  const answer = words(value.answer, PARTNER_ANSWER_MAX);
  if (facts.length === 0 && !recommendation && !draft && !answer) return null;
  return { facts, recommendation, draft, answer };
}
