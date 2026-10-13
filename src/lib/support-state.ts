import type { Handler, ConversationStatus, SupportMode } from "./support-rules";

/**
 * A support conversation's life (D216, `docs/support.md` 4.2): who answers it (`handler`) and whether it is open, by the desk's
 * mode. Pure, and mirrored row for row by `commerce.support_transition()`; `src/db/support.test.ts` holds the two together.
 */

export type ConversationState = {
  status: ConversationStatus;
  handler: Handler;
  /** The agent who has it, when the handler is `human` and it is open. */
  assignee: string | null;
  /** Anonymised: its transcript is gone and nothing can happen to it. */
  gone?: boolean;
};

export type SupportEvent = "handoff" | "claim" | "transfer" | "hand_back" | "end" | "reopen";

export type Actor =
  | { kind: "customer" }
  | { kind: "ai" }
  | { kind: "system" }
  | { kind: "agent"; id: string };

export const REFUSALS = [
  "support_taken",
  "support_not_yours",
  "support_bad_event",
  "support_ended",
  "support_gone",
  "support_no_ai",
  "support_off",
] as const;
export type Refusal = (typeof REFUSALS)[number];

/** Plain words for each refusal (`supportGuard()` shows them; the admin is English only). */
export const REFUSAL_WORDS: Record<Refusal, string> = {
  support_taken: "Someone else has this conversation now.",
  support_not_yours: "This conversation is not yours to answer.",
  support_bad_event: "That cannot be done with this conversation now.",
  support_ended: "This conversation has ended.",
  support_gone: "This conversation's messages have been deleted.",
  support_no_ai: "This desk does not let the AI answer customers.",
  support_off: "Support is switched off for this desk.",
};

/** The system line each successful event writes (`kind`), in order. */
export type SystemLine = "queued" | "joined" | "left" | "assistant_back" | "ended" | "reopened";

export type Transition =
  | { ok: true; state: ConversationState; lines: SystemLine[] }
  | { ok: false; refusal: Refusal };

/** Where a new conversation starts. */
export function startingHandler(mode: SupportMode): Handler {
  return mode === "people" ? "queue" : "ai";
}

const refuse = (refusal: Refusal): Transition => ({ ok: false, refusal });
const open = (handler: Handler, assignee: string | null = null): ConversationState => ({ status: "open", handler, assignee });

/**
 * The next state after `event`, or why not. `target` is the agent a transfer goes to (null: back to the queue).
 */
export function nextState(
  state: ConversationState,
  event: SupportEvent,
  actor: Actor,
  mode: SupportMode,
  target: string | null = null,
): Transition {
  if (state.gone) return refuse("support_gone");
  const isOpen = state.status === "open";
  const agent = actor.kind === "agent" ? actor.id : null;
  const isAssignee = agent !== null && state.handler === "human" && state.assignee === agent;

  switch (event) {
    case "handoff": {
      if (!isOpen) return refuse("support_ended");
      if (mode === "off") return refuse("support_off");
      if (mode !== "ai_first") return refuse("support_no_ai");
      if (state.handler !== "ai") return refuse("support_bad_event");
      if (actor.kind === "agent") return refuse("support_bad_event");
      return { ok: true, state: open("queue"), lines: ["queued"] };
    }
    case "claim": {
      if (!isOpen) return refuse("support_ended");
      if (mode === "off") return refuse("support_off");
      if (agent === null) return refuse("support_bad_event");
      if (state.handler === "human") return refuse(state.assignee === agent ? "support_bad_event" : "support_taken");
      return { ok: true, state: open("human", agent), lines: ["joined"] };
    }
    case "transfer": {
      if (!isOpen) return refuse("support_ended");
      if (mode === "off") return refuse("support_off");
      if (!isAssignee) return refuse(state.handler === "human" ? "support_not_yours" : "support_bad_event");
      if (target === agent) return refuse("support_bad_event");
      return target === null
        ? { ok: true, state: open("queue"), lines: ["queued"] }
        : { ok: true, state: open("human", target), lines: ["joined"] };
    }
    case "hand_back": {
      if (!isOpen) return refuse("support_ended");
      if (mode === "off") return refuse("support_off");
      if (mode !== "ai_first") return refuse("support_no_ai");
      if (state.handler === "queue" && actor.kind === "customer") return { ok: true, state: open("ai"), lines: ["assistant_back"] };
      if (state.handler === "human" && isAssignee) return { ok: true, state: open("ai"), lines: ["left", "assistant_back"] };
      if (state.handler === "human" && agent !== null) return refuse("support_not_yours");
      return refuse("support_bad_event");
    }
    case "end": {
      if (!isOpen) return refuse("support_ended");
      if (actor.kind === "customer" || actor.kind === "system" || isAssignee) {
        return { ok: true, state: { status: "ended", handler: state.handler, assignee: null }, lines: ["ended"] };
      }
      if (agent !== null && state.handler === "human") return refuse("support_not_yours");
      return refuse("support_bad_event");
    }
    case "reopen": {
      if (isOpen) return refuse("support_bad_event");
      if (actor.kind === "customer") return { ok: true, state: open(startingHandler(mode)), lines: ["reopened"] };
      if (agent !== null) {
        if (mode === "off") return refuse("support_off");
        return { ok: true, state: open("human", agent), lines: ["reopened", "joined"] };
      }
      return refuse("support_bad_event");
    }
  }
}
