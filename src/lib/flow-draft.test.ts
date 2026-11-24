import { describe, expect, it } from "vitest";

import { draftGoals, draftSteps, draftWords } from "./flow-draft";
import { checkFlow } from "./flows";

/** A flow from the owner's sentence (email plan M3.2): built by code, checked as any flow. */
describe("a drafted flow's steps", () => {
  it("waits before each later email, splits paragraphs and puts a conditional email on its side of an if", () => {
    const steps = draftSteps(
      [
        { after_days: 0, subject: "Welcome", text: "Hello.\n\nGlad you are here." },
        { after_days: 3, subject: "Our favourites", text: "Have a look.", only_if: "has_not_ordered" },
        { after_days: 7, subject: "Thank you", text: "Thanks for ordering.", only_if: "has_ordered" },
      ],
      "nb-NO",
    );
    expect(steps.map((s) => s.kind)).toEqual(["email", "wait", "if", "wait", "if"]);
    expect(steps[0]).toMatchObject({ content: { "nb-NO": { blocks: [{ text: "Hello." }, { text: "Glad you are here." }] } } });
    expect(steps[1]).toMatchObject({ hours: 72 });
    expect(steps[2]).toMatchObject({ condition: { kind: "ordered_since_entry" }, then: [], else: [{ id: "email-2" }] });
    expect(steps[4]).toMatchObject({ then: [{ id: "email-3" }], else: [] });
    expect(checkFlow(steps)).toEqual([]);
  });

  it("ends on an order only when asked, and gives every word to the claims check", () => {
    expect(draftGoals(true)).toEqual([{ kind: "ordered" }]);
    expect(draftGoals(undefined)).toEqual([]);
    expect(draftWords([{ after_days: 0, subject: "A", text: "B" }])).toBe("A\nB");
  });
});
