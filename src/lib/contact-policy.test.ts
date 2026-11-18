import { describe, expect, it } from "vitest";

import { contactPolicySchema, policyVerdict, POLICY_DEFAULT } from "./contact-policy";

const now = new Date("2026-11-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("one contact policy across email and texts (email plan M1.5, D764)", () => {
  it("lets a message go under the week's cap and after the spacing", () => {
    expect(policyVerdict([], now, POLICY_DEFAULT, "normal")).toBeNull();
    expect(policyVerdict([hoursAgo(30), hoursAgo(100)], now, POLICY_DEFAULT, "normal")).toBeNull();
  });

  it("holds one at the week's cap, counting only the last 7 days", () => {
    expect(policyVerdict([hoursAgo(30), hoursAgo(60), hoursAgo(100)], now, POLICY_DEFAULT, "normal")).toBe("cap");
    expect(policyVerdict([hoursAgo(30), hoursAgo(60), hoursAgo(169)], now, POLICY_DEFAULT, "normal")).toBeNull();
  });

  it("holds one too soon after the last, unless spacing is off", () => {
    expect(policyVerdict([hoursAgo(5)], now, POLICY_DEFAULT, "normal")).toBe("spacing");
    expect(policyVerdict([hoursAgo(5)], now, { ...POLICY_DEFAULT, spacingHours: 0 }, "normal")).toBeNull();
  });

  it("always lets a message the person set off go", () => {
    expect(policyVerdict([hoursAgo(1), hoursAgo(2), hoursAgo(3)], now, POLICY_DEFAULT, "first")).toBeNull();
  });

  it("ignores instants after now and that are not dates", () => {
    expect(policyVerdict([new Date(now.getTime() + 3_600_000).toISOString(), "nonsense"], now, { ...POLICY_DEFAULT, perWeek: 1 }, "normal")).toBeNull();
  });

  it("reads a form's values, a missing checkbox being off", () => {
    expect(contactPolicySchema.parse({ perWeek: "4", spacingHours: "12", quietHours: "on" })).toEqual({ perWeek: 4, spacingHours: 12, quietHours: true });
    expect(contactPolicySchema.parse({ perWeek: "4", spacingHours: "0", quietHours: null })).toEqual({ perWeek: 4, spacingHours: 0, quietHours: false });
    expect(contactPolicySchema.safeParse({ perWeek: "0", spacingHours: "1", quietHours: null }).success).toBe(false);
    expect(contactPolicySchema.safeParse({ perWeek: "3", spacingHours: "100", quietHours: null }).success).toBe(false);
  });
});
