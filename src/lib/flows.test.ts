import { describe, expect, it } from "vitest";

import { advance, checkFlow, nextPath, pathOf, pathText, stepAt, type FlowFacts, type FlowStep } from "./flows";

const email = (id: string, subject = "Hei"): FlowStep => ({
  id,
  kind: "email",
  content: { "nb-NO": { subject, preview: "", blocks: [{ type: "paragraph", text: "Hei" }] } },
});
const facts = (over: Partial<FlowFacts> = {}): FlowFacts => ({ orderedSinceEntry: false, clickedFlowEmail: false, segments: new Set(), ...over });

// Welcome, three days, then: if they have not ordered, best sellers; else a thank-you. Then a last email.
const tree: FlowStep[] = [
  email("welcome"),
  { id: "w1", kind: "wait", hours: 72 },
  { id: "q", kind: "if", condition: { kind: "ordered_since_entry" }, then: [email("thanks")], else: [email("best"), { id: "w2", kind: "wait", hours: 48 }] },
  email("last"),
];

describe("flows (D767, email plan M2.1)", () => {
  it("accepts a sound tree and says what is wrong with another, in words", () => {
    expect(checkFlow(tree)).toEqual([]);
    expect(checkFlow([])).toContain("A flow needs at least one step.");
    expect(checkFlow([{ id: "w", kind: "wait", hours: 1 }])).toContain("A flow sends at least one email.");
    expect(checkFlow([email("a"), email("a")])).toContain("Two steps have the same id.");
    expect(checkFlow([email("a", "")])).toContain('The email "a" has no subject or no words yet.');
    const deep = (n: number): FlowStep => (n === 0 ? email(`e${n}`) : { id: `i${n}`, kind: "if", condition: { kind: "clicked_flow_email" }, then: [deep(n - 1)], else: [] });
    expect(checkFlow([deep(5)])).toContain("Branches go at most 4 deep.");
  });

  it("walks places through branches and on after them", () => {
    expect(stepAt(tree, ["2", "else", "1"])).toMatchObject({ id: "w2" });
    expect(nextPath(tree, ["0"])).toEqual(["1"]);
    expect(nextPath(tree, ["2", "else", "0"])).toEqual(["2", "else", "1"]);
    // The end of a branch goes on after its `if`.
    expect(nextPath(tree, ["2", "else", "1"])).toEqual(["3"]);
    expect(nextPath(tree, ["2", "then", "0"])).toEqual(["3"]);
    expect(nextPath(tree, ["3"])).toBeNull();
    expect(pathOf(pathText(["2", "then", "0"]))).toEqual(["2", "then", "0"]);
  });

  it("sends, waits, takes the branch the person's facts choose, and ends", () => {
    expect(advance(tree, [], ["0"], facts())).toMatchObject({ do: "email", step: { id: "welcome" }, next: ["1"] });
    expect(advance(tree, [], ["1"], facts())).toEqual({ do: "wait", hours: 72, next: ["2"] });
    expect(advance(tree, [], ["2"], facts())).toMatchObject({ do: "email", step: { id: "best" }, next: ["2", "else", "1"] });
    expect(advance(tree, [], ["2"], facts({ orderedSinceEntry: true }))).toMatchObject({ do: "email", step: { id: "thanks" }, next: ["3"] });
    expect(advance(tree, [], ["3"], facts())).toMatchObject({ do: "email", step: { id: "last" }, next: null });
    expect(advance(tree, [], null, facts())).toEqual({ do: "end", reason: "done" });
  });

  it("ends a run at once when a goal is met", () => {
    expect(advance(tree, [{ kind: "ordered" }], ["2"], facts({ orderedSinceEntry: true }))).toEqual({ do: "end", reason: "goal" });
  });

  it("goes past an empty branch, and decides a segment condition from the person's segments", () => {
    const seg = "11111111-1111-4111-8111-111111111111";
    const steps: FlowStep[] = [{ id: "q", kind: "if", condition: { kind: "in_segment", segmentId: seg }, then: [email("vip")], else: [] }, email("all")];
    expect(advance(steps, [], ["0"], facts())).toMatchObject({ do: "email", step: { id: "all" } });
    expect(advance(steps, [], ["0"], facts({ segments: new Set([seg]) }))).toMatchObject({ do: "email", step: { id: "vip" } });
  });
});

describe("changing a flow where it is (D767 slice 2)", () => {
  it("changes one email's subject and first paragraph in one language, inside a branch too, and leaves the rest", async () => {
    const { withEmailWords } = await import("./flows");
    const changed = withEmailWords(tree, "best", "nb-NO", { subject: "Våre favoritter", text: "Se hva andre kjøper." });
    expect(stepAt(changed, ["2", "else", "0"])).toMatchObject({
      id: "best",
      content: { "nb-NO": { subject: "Våre favoritter", blocks: [{ type: "paragraph", text: "Se hva andre kjøper." }] } },
    });
    expect(stepAt(changed, ["0"])).toEqual(stepAt(tree, ["0"]));
    // A language it had none of yet gets the words as its first paragraph.
    const added = withEmailWords(tree, "welcome", "en-GB", { subject: "Welcome", text: "Hello" });
    expect(stepAt(added, ["0"])).toMatchObject({ content: { "en-GB": { subject: "Welcome", blocks: [{ type: "paragraph", text: "Hello" }] }, "nb-NO": { subject: "Hei" } } });
  });

  it("changes a wait in days", async () => {
    const { withWaitDays } = await import("./flows");
    expect(stepAt(withWaitDays(tree, "w1", 5), ["1"])).toEqual({ id: "w1", kind: "wait", hours: 120 });
  });
});

describe("the canvas's changes (D767 slice 2)", () => {
  it("adds a step after another, first in a branch, with a free id, and removes one", async () => {
    const { insertStep, newStep, removeStep, freeStepId } = await import("./flows");
    expect(freeStepId(tree, "email")).toBe("email-1");
    const wait = newStep(tree, "wait", "nb-NO", { subject: "", text: "" });
    expect(wait).toEqual({ id: "wait-1", kind: "wait", hours: 24 });
    const after = insertStep(tree, wait, { afterId: "welcome" });
    expect(after.map((s) => s.id)).toEqual(["welcome", "wait-1", "w1", "q", "last"]);
    const mail = newStep(after, "email", "nb-NO", { subject: "Ny", text: "Tekst" });
    const inBranch = insertStep(after, mail, { into: "q", branch: "then" });
    expect(stepAt(inBranch, ["3", "then", "0"])).toMatchObject({ id: "email-1", content: { "nb-NO": { subject: "Ny" } } });
    expect(stepAt(removeStep(inBranch, "email-1"), ["3", "then", "0"])).toMatchObject({ id: "thanks" });
    // An `if` goes with its branches.
    expect(removeStep(tree, "q").map((s) => s.id)).toEqual(["welcome", "w1", "last"]);
  });

  it("changes an if's condition", async () => {
    const { withCondition } = await import("./flows");
    expect(stepAt(withCondition(tree, "q", { kind: "clicked_flow_email" }), ["2"])).toMatchObject({ condition: { kind: "clicked_flow_email" } });
  });
});
