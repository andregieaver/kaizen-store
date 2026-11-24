import { describe, expect, it } from "vitest";

import { storyLead, storyLines, triggerLabel, waitWords, type StoryWords } from "./flow-story";
import type { FlowStep } from "./flows";

const w: StoryWords = {
  triggers: { "subscriber.subscribed": "When someone joins your list:" },
  anySegment: "a segment",
  sameDay: "the same day",
  after: { hours: { one: "an hour later", many: "{n} hours later" }, days: { one: "a day later", many: "{n} days later" } },
  conditions: {
    ordered: { yes: "if they have ordered", no: "if they have not ordered" },
    clicked: { yes: "if they pressed a link", no: "if they did not press a link" },
    segment: { yes: "if they are in {segment}", no: "if they are not in {segment}" },
    split: { yes: "for half of them (a split test)", no: "for the other half" },
  },
  until: { ordered: "once they order, or {n} days later", clicked: "once they press a link, or {n} days later" },
  goal: "It ends when they order.",
  ends: "Then it ends.",
};

const email = (id: string, subject: string): FlowStep => ({ id, kind: "email", content: { "nb-NO": { subject, preview: "", blocks: [] } } });

describe("a flow as the owner reads it (D767 slice 2, M3.3)", () => {
  it("says a wait in days, hours, or the same day", () => {
    expect(waitWords(0, w)).toBe("the same day");
    expect(waitWords(24, w)).toBe("a day later");
    expect(waitWords(72, w)).toBe("3 days later");
    expect(waitWords(1, w)).toBe("an hour later");
    expect(waitWords(30, w)).toBe("30 hours later");
  });

  it("tells each email with the wait before it and the conditions that lead to it", () => {
    const steps: FlowStep[] = [
      email("welcome", "Velkommen"),
      { id: "w", kind: "wait", hours: 72 },
      { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("thanks", "Takk")], else: [email("best", "Bestselgere"), { id: "w2", kind: "wait", hours: 48 }, email("last", "Siste")] },
    ];
    expect(storyLines(steps, w)).toEqual([
      { stepId: "welcome", when: "the same day", condition: null, subject: "Velkommen", depth: 0, waitId: null, waitDays: null },
      { stepId: "thanks", when: "3 days later", condition: "if they have ordered", subject: "Takk", depth: 1, waitId: "w", waitDays: 3 },
      { stepId: "best", when: "3 days later", condition: "if they have not ordered", subject: "Bestselgere", depth: 1, waitId: "w", waitDays: 3 },
      { stepId: "last", when: "2 days later", condition: "if they have not ordered", subject: "Siste", depth: 1, waitId: "w2", waitDays: 2 },
    ]);
  });

  it("names a segment by its name, and stops at an end", () => {
    const steps: FlowStep[] = [
      { id: "q", kind: "if", condition: { kind: "in_segment", segmentId: "s1" }, then: [email("vip", "VIP"), { id: "e", kind: "end" }, email("never", "Never")], else: [] },
    ];
    expect(storyLines(steps, w, () => "Best customers").map((l) => [l.subject, l.condition])).toEqual([["VIP", "if they are in Best customers"]]);
  });

  it("leads with what starts it and what ends it early", () => {
    expect(storyLead("subscriber.subscribed", [{ kind: "ordered" }], w)).toBe("When someone joins your list: It ends when they order.");
    expect(storyLead("subscriber.subscribed", [], w)).toBe("When someone joins your list:");
  });
});

describe("a lapse flow's lead (slice 4)", () => {
  it("names the days without an order", () => {
    const words = { ...w, triggers: { "customer.lapsed": "When someone has not ordered for {n} days:" } };
    expect(storyLead("customer.lapsed", [{ kind: "ordered" }], words, 90)).toBe("When someone has not ordered for 90 days: It ends when they order.");
  });
});

describe("what starts a flow, as a label (M2.3)", () => {
  it("is the story's sentence without its colon, a date trigger's usual days when none are given", () => {
    const words = {
      anySegment: "a segment",
      triggers: { "order.refunded": "When an order is refunded:", "customer.lapsed": "When someone has not ordered for {n} days:", "segment.entered": "When someone enters {segment}:" },
    };
    expect(triggerLabel("order.refunded", words, null)).toBe("When an order is refunded");
    expect(triggerLabel("customer.lapsed", words, null)).toBe("When someone has not ordered for 90 days");
    expect(triggerLabel("customer.lapsed", words, 120)).toBe("When someone has not ordered for 120 days");
    expect(triggerLabel("segment.entered", words, null)).toBe("When someone enters a segment");
    expect(triggerLabel("segment.entered", words, null, "VIP")).toBe("When someone enters VIP");
    const browse = { ...words, triggers: { "customer.browsed": "{n} days after someone looked:" }, triggersOne: { "customer.browsed": "A day after someone looked:" } };
    expect(triggerLabel("customer.browsed", browse, null)).toBe("A day after someone looked");
    expect(triggerLabel("customer.browsed", browse, 3)).toBe("3 days after someone looked");
    expect(storyLead("customer.browsed", [], { ...w, ...browse }, 1)).toBe("A day after someone looked:");
    const planned = { ...w, triggers: { schedule: "On {when}, to {who}:" }, scheduleEvery: "Every {n} days from {when}, to {who}:", everyone: "everyone on your list" };
    expect(storyLead("schedule", [], planned, null, null, { when: "1 Dec, 09:00", every: null })).toBe("On 1 Dec, 09:00, to everyone on your list:");
    expect(storyLead("schedule", [], planned, null, "VIP", { when: "1 Dec, 09:00", every: 7 })).toBe("Every 7 days from 1 Dec, 09:00, to VIP:");
  });
});
