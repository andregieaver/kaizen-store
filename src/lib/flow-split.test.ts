import { describe, expect, it } from "vitest";

import { keepWay, splitFigures, splitsOf, splitWorthTrying } from "./flow-split";
import type { FlowStep } from "./flows";

const email = (id: string): FlowStep => ({ id, kind: "email", content: {} });
const steps: FlowStep[] = [
  email("hello"),
  { id: "s", kind: "if", condition: { kind: "split" }, then: [email("a")], else: [{ id: "w", kind: "wait", hours: 24 }, email("b")] },
  email("bye"),
];

describe("a flow's split tests (M2.5, D868)", () => {
  it("finds the splits, and counts each way's people and orders", () => {
    expect(splitsOf(steps).map((s) => s.id)).toEqual(["s"]);
    const split = splitsOf(steps)[0];
    const figures = splitFigures(split, new Map([["a", 400], ["w", 410], ["b", 405]]), new Map([["a", 20], ["b", 60]]));
    expect(figures).toMatchObject({ first: { people: 400, orders: 20 }, second: { people: 410, orders: 60 }, call: "better", better: "else" });
  });

  it("calls nothing clear with too few people or no difference", () => {
    const split = splitsOf(steps)[0];
    expect(splitFigures(split, new Map([["a", 50], ["b", 50]]), new Map([["b", 20]]))).toMatchObject({ call: "few", better: null });
    expect(splitFigures(split, new Map([["a", 400], ["b", 400]]), new Map([["a", 20], ["b", 22]]))).toMatchObject({ call: "even", better: null });
  });

  it("keeps one way in the split's place, and drops the other", () => {
    expect(keepWay(steps, "s", "else").map((s) => s.id)).toEqual(["hello", "w", "b", "bye"]);
    expect(keepWay(steps, "s", "then").map((s) => s.id)).toEqual(["hello", "a", "bye"]);
    expect(keepWay(steps, "nope", "then")).toEqual(steps);
  });

  it("suggests a test for a flow with enough people for both halves and no split yet (slice 5)", () => {
    const plain: FlowStep[] = [email("hello"), email("bye")];
    expect(splitWorthTrying(plain, 400)).toBe(true);
    expect(splitWorthTrying(plain, 399)).toBe(false);
    expect(splitWorthTrying(steps, 5000)).toBe(false);
  });
});
