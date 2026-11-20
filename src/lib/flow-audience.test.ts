import { describe, expect, it } from "vitest";

import { flowAudience } from "./flow-audience";
import type { FlowStep } from "./flows";

const email = (id: string, picks?: "cross_sell"): FlowStep => ({
  id,
  kind: "email",
  content: { "en-GB": { subject: id, preview: "", blocks: [{ type: "paragraph", text: id }] } },
  ...(picks ? { picks } : {}),
});
const steps: FlowStep[] = [
  email("a"),
  { id: "w", kind: "wait", hours: 72 },
  { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("b", "cross_sell")], else: [{ id: "w2", kind: "wait", hours: 5 }, email("c")] },
];

describe("who a flow's email reaches, for the writer (M3.7)", () => {
  it("says what starts it and that it is the first, sent at once", () => {
    expect(flowAudience(steps, "a", "subscriber.subscribed", null)).toBe(
      "It goes to each person who joins the shop's list. This is email 1 of the flow, sent as soon as the flow starts for them.",
    );
  });

  it("says a later email's place, days and branch, never to repeat a welcome, and that picked products are not its to name", () => {
    const b = flowAudience(steps, "b", "order.sent", null);
    expect(b).toContain("This is email 2 of the flow, sent 3 days after the flow starts for them, only to those who have ordered since the flow started for them.");
    expect(b).toContain("never repeat a welcome");
    expect(b).toContain("choose no products yourself");
    expect(flowAudience(steps, "c", "customer.lapsed", 120)).toContain("not ordered for 120 days");
    expect(flowAudience(steps, "c", "customer.lapsed", 120)).toContain("sent 77 hours after the flow starts for them, only to those who have not ordered");
  });
});

describe("what the flow's emails earned, for the writer (M3.7)", () => {
  it("names the email that brought the most and warns when readers leave, never to say the numbers", async () => {
    const { earnedWords } = await import("./flow-audience");
    const base = { entered: 40, sent: 60, orders: 5, minor: { NOK: 100000 }, topStep: { id: "a", orders: 4 }, left: 3 };
    const said = earnedWords(base, steps);
    expect(said).toContain('40 people started this flow and its emails brought 5 orders.');
    expect(said).toContain('The email that brought the most was "a"');
    expect(said).toContain("More than 1 in 20 left the list");
    expect(said).toContain("Never put these numbers in the email.");
    expect(earnedWords({ ...base, left: 0, topStep: null, orders: 0 }, steps)).not.toContain("brought the most");
    expect(earnedWords({ ...base, entered: 0 }, steps)).toBe("");
  });
});
