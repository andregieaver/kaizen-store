import { describe, expect, it } from "vitest";

import { checkGuardrail, guardrailStop, guardrailWarning, returnsStillComing, type GuardrailCount } from "./experiment-guardrails";

const two = (a: [number, number], b: [number, number]): GuardrailCount[] => [
  { key: "a", n: a[0], bad: a[1] },
  { key: "b", n: b[0], bad: b[1] },
];

describe("A/B guardrails (D148 phase 19)", () => {
  it("keeps the orders rule of phase 1: fewer orders, clearly, once every version has 1,000 visitors", () => {
    expect(checkGuardrail("orders", two([5000, 250], [5000, 150])).worst).toBe("b");
    expect(checkGuardrail("orders", two([5000, 250], [5000, 240])).state).toBe("fine");
    expect(checkGuardrail("orders", two([999, 100], [5000, 0])).state).toBe("watching");
  });

  it("stops on slower pages only when clearly worse and at least five in a hundred more loads are slow", () => {
    // 10 % against 20 % slow over 2,000 loads each: clear, and ten points more.
    expect(checkGuardrail("speed", two([2000, 200], [2000, 400]))).toMatchObject({ state: "worse", worst: "b" });
    // 10 % against 13 % over 20,000 loads each: clear by the interval, but under the floor of five points.
    expect(checkGuardrail("speed", two([20000, 2000], [20000, 2600])).state).toBe("fine");
    // Faster is never trouble.
    expect(checkGuardrail("speed", two([2000, 400], [2000, 100])).state).toBe("fine");
    expect(checkGuardrail("speed", two([2000, 200], [399, 300])).state).toBe("watching");
  });

  it("is off for speed when the store does not count visits, whatever the counts", () => {
    expect(checkGuardrail("speed", two([2000, 200], [2000, 900]), { off: true })).toMatchObject({ state: "off", worst: null });
  });

  it("stops on failed payments at checkout past the interval and two points more", () => {
    expect(checkGuardrail("checkout", two([1000, 20], [1000, 80])).worst).toBe("b");
    expect(checkGuardrail("checkout", two([1000, 20], [1000, 30])).state).toBe("fine");
    expect(checkGuardrail("checkout", two([199, 0], [1000, 500])).state).toBe("watching");
  });

  it("finds the worse of several versions, never the original", () => {
    const counts: GuardrailCount[] = [
      { key: "a", n: 1000, bad: 20 },
      { key: "b", n: 1000, bad: 25 },
      { key: "c", n: 1000, bad: 90 },
    ];
    expect(checkGuardrail("checkout", counts).worst).toBe("c");
  });

  it("says refunds and returns, and says when they are still coming in, but never stops on them", () => {
    const check = checkGuardrail("returns", two([400, 20], [400, 60]), { stillComing: true });
    expect(check).toMatchObject({ state: "worse", worst: "b", stillComing: true });
    expect(guardrailStop([check])).toBeNull();
    expect(guardrailWarning([check])?.worst).toBe("b");
    const now = new Date("2026-11-17T12:00:00Z");
    expect(returnsStillComing(null, now)).toBe(true);
    expect(returnsStillComing(new Date("2026-10-30T12:00:00Z"), now)).toBe(true);
    expect(returnsStillComing(new Date("2026-10-10T12:00:00Z"), now)).toBe(false);
  });

  it("stops on the first guardrail in the order orders, checkout, speed", () => {
    const speed = checkGuardrail("speed", two([2000, 200], [2000, 400]));
    const checkout = checkGuardrail("checkout", two([1000, 20], [1000, 80]));
    expect(guardrailStop([speed, checkout])).toEqual({ kind: "checkout", version: "b" });
    expect(guardrailStop([speed])).toEqual({ kind: "speed", version: "b" });
    expect(guardrailStop([checkGuardrail("speed", two([2000, 200], [2000, 210]))])).toBeNull();
  });

  it("never counts more trouble than there were people or loads", () => {
    const check = checkGuardrail("checkout", two([300, 5], [300, 900]));
    expect(check.versions[1]).toMatchObject({ n: 300, bad: 300, share: 1 });
  });
});
