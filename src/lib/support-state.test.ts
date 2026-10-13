import { describe, expect, it } from "vitest";

import { nextState, startingHandler, type Actor, type ConversationState } from "./support-state";

const customer: Actor = { kind: "customer" };
const ai: Actor = { kind: "ai" };
const system: Actor = { kind: "system" };
const ana: Actor = { kind: "agent", id: "ana" };
const bo: Actor = { kind: "agent", id: "bo" };

const withAi: ConversationState = { status: "open", handler: "ai", assignee: null };
const waiting: ConversationState = { status: "open", handler: "queue", assignee: null };
const anaHas: ConversationState = { status: "open", handler: "human", assignee: "ana" };
const ended: ConversationState = { status: "ended", handler: "human", assignee: null };

describe("a support conversation's life (D216, 4.2)", () => {
  it("starts with the AI, or waiting for a person on a desk of people only", () => {
    expect(startingHandler("ai_first")).toBe("ai");
    expect(startingHandler("off")).toBe("ai");
    expect(startingHandler("people")).toBe("queue");
  });

  it("hands over from the AI to the queue, only with the AI first", () => {
    for (const who of [customer, ai, system]) {
      expect(nextState(withAi, "handoff", who, "ai_first")).toEqual({ ok: true, state: waiting, lines: ["queued"] });
    }
    expect(nextState(withAi, "handoff", customer, "people")).toEqual({ ok: false, refusal: "support_no_ai" });
    expect(nextState(withAi, "handoff", customer, "off")).toEqual({ ok: false, refusal: "support_off" });
    expect(nextState(waiting, "handoff", customer, "ai_first")).toEqual({ ok: false, refusal: "support_bad_event" });
  });

  it("lets an agent take over from the AI or the queue, once", () => {
    expect(nextState(withAi, "claim", ana, "ai_first")).toEqual({ ok: true, state: anaHas, lines: ["joined"] });
    expect(nextState(waiting, "claim", ana, "people")).toEqual({ ok: true, state: anaHas, lines: ["joined"] });
    expect(nextState(anaHas, "claim", bo, "ai_first")).toEqual({ ok: false, refusal: "support_taken" });
    expect(nextState(withAi, "claim", customer, "ai_first")).toEqual({ ok: false, refusal: "support_bad_event" });
    expect(nextState(withAi, "claim", ana, "off")).toEqual({ ok: false, refusal: "support_off" });
  });

  it("transfers only by the agent who has it, to another agent or back to the queue", () => {
    expect(nextState(anaHas, "transfer", ana, "people", "bo")).toEqual({ ok: true, state: { status: "open", handler: "human", assignee: "bo" }, lines: ["joined"] });
    expect(nextState(anaHas, "transfer", ana, "people", null)).toEqual({ ok: true, state: waiting, lines: ["queued"] });
    expect(nextState(anaHas, "transfer", bo, "people", "bo")).toEqual({ ok: false, refusal: "support_not_yours" });
    expect(nextState(anaHas, "transfer", ana, "people", "ana")).toEqual({ ok: false, refusal: "support_bad_event" });
  });

  it("gives back to the AI: the customer from the queue, the agent who has it, only with the AI first", () => {
    expect(nextState(waiting, "hand_back", customer, "ai_first")).toEqual({ ok: true, state: withAi, lines: ["assistant_back"] });
    expect(nextState(anaHas, "hand_back", ana, "ai_first")).toEqual({ ok: true, state: withAi, lines: ["left", "assistant_back"] });
    expect(nextState(anaHas, "hand_back", bo, "ai_first")).toEqual({ ok: false, refusal: "support_not_yours" });
    expect(nextState(anaHas, "hand_back", customer, "ai_first")).toEqual({ ok: false, refusal: "support_bad_event" });
    expect(nextState(waiting, "hand_back", customer, "people")).toEqual({ ok: false, refusal: "support_no_ai" });
  });

  it("ends by the customer, the system or the agent who has it", () => {
    expect(nextState(withAi, "end", customer, "ai_first")).toEqual({ ok: true, state: { status: "ended", handler: "ai", assignee: null }, lines: ["ended"] });
    expect(nextState(waiting, "end", system, "people").ok).toBe(true);
    expect(nextState(anaHas, "end", ana, "people").ok).toBe(true);
    expect(nextState(anaHas, "end", bo, "people")).toEqual({ ok: false, refusal: "support_not_yours" });
    expect(nextState(ended, "end", customer, "people")).toEqual({ ok: false, refusal: "support_ended" });
  });

  it("reopens to where a new conversation starts, or to the agent who reopens it", () => {
    expect(nextState(ended, "reopen", customer, "ai_first")).toEqual({ ok: true, state: withAi, lines: ["reopened"] });
    expect(nextState(ended, "reopen", customer, "people")).toEqual({ ok: true, state: waiting, lines: ["reopened"] });
    expect(nextState(ended, "reopen", ana, "people")).toEqual({ ok: true, state: anaHas, lines: ["reopened", "joined"] });
    expect(nextState(anaHas, "reopen", customer, "people")).toEqual({ ok: false, refusal: "support_bad_event" });
  });

  it("refuses everything once the transcript is gone, and anything but reopening once ended", () => {
    for (const event of ["handoff", "claim", "transfer", "hand_back", "end", "reopen"] as const) {
      expect(nextState({ ...ended, gone: true }, event, ana, "ai_first")).toEqual({ ok: false, refusal: "support_gone" });
      if (event !== "reopen") expect(nextState(ended, event, ana, "ai_first")).toEqual({ ok: false, refusal: "support_ended" });
    }
  });
});
