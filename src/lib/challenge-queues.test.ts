import { describe, expect, it } from "vitest";

import { stallKey } from "./challenge-stalls";
import { classOfAction, classOfDecision, classOfReply } from "./interventions";
import { escalationOf } from "./support-rules";

describe("escalations (docs/100-day-challenge.md A4)", () => {
  it("are what the challenge lets reach a person, and a fault is none", () => {
    expect(escalationOf("customer", null)).toBe("asked_for_person");
    expect(escalationOf("tone", null)).toBe("upset");
    expect(escalationOf("ai", "legal")).toBe("legal");
    expect(escalationOf("ai", null)).toBe("could_not_help");
    expect(escalationOf("ai", "nonsense")).toBe("could_not_help");
    expect(escalationOf("no_ai", null)).toBeNull();
    expect(escalationOf("limit", "legal")).toBeNull();
    expect(escalationOf(null, null)).toBeNull();
  });
});

describe("the intervention log (A5)", () => {
  it("counts a refund decided and an escalation answered as allowed, anything else as an intervention", () => {
    expect(classOfDecision("refund_order")).toBe("refund");
    expect(classOfDecision("issue_gift_card")).toBe("refund");
    expect(classOfDecision("publish_page")).toBe("other");
    expect(classOfReply(true)).toBe("escalation");
    expect(classOfReply(false)).toBe("other");
  });

  it("reads an audited action: a platform fix, a refund by hand, support counted from its messages, the rest an intervention", () => {
    expect(classOfAction("store.theme_live", true)).toBe("platform");
    expect(classOfAction("return.refunded", false)).toBe("refund");
    // The platform's own actions on a store (its approval) are platform fixes whoever pressed.
    expect(classOfAction("platform.access_approved", false)).toBe("platform");
    expect(classOfAction("support.claimed", false)).toBeNull();
    expect(classOfAction("ai.challenge_paused", false)).toBe("other");
    expect(classOfAction("product.updated", false)).toBe("other");
  });
});

describe("the stall watch (A6)", () => {
  it("tells each stall once a day", () => {
    const stall = { storeId: "s1", kind: "budget" as const, ref: "2027-01" };
    expect(stallKey(stall, "2027-01-05")).toBe("challenge-stall:s1:budget:2027-01:2027-01-05");
    expect(stallKey(stall, "2027-01-06")).not.toBe(stallKey(stall, "2027-01-05"));
  });
});
