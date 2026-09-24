import { describe, expect, it } from "vitest";

import { accountStage, accountStatus, platformKey, requirementNotes, saleFee } from "./stripe-account";

describe("platformKey", () => {
  it("accepts keys for the right mode, including restricted keys", () => {
    expect(platformKey("secret", "test", "sk_test_abc")).toBe("sk_test_abc");
    expect(platformKey("secret", "live", " rk_live_abc ")).toBe("rk_live_abc");
    expect(platformKey("publishable", "test", "pk_test_abc")).toBe("pk_test_abc");
  });

  it("refuses keys for the other mode, the other kind, or with spaces", () => {
    expect(platformKey("secret", "live", "sk_test_abc")).toBeNull();
    expect(platformKey("secret", "test", "pk_test_abc")).toBeNull();
    expect(platformKey("publishable", "test", "sk_test_abc")).toBeNull();
    expect(platformKey("secret", "test", "sk_test_a b")).toBeNull();
    expect(platformKey("secret", "test", undefined)).toBeNull();
  });
});

describe("accountStatus", () => {
  it("reads the card payments capability and whether the owner has anything to do", () => {
    expect(
      accountStatus({
        configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
        requirements: {
          entries: [
            { awaiting_action_from: "user", minimum_deadline: { status: "eventually_due" } },
            { awaiting_action_from: "stripe", minimum_deadline: { status: "currently_due" } },
          ],
        },
      }),
    ).toEqual({ cardPayments: "active", requirementsDue: false });

    expect(
      accountStatus({
        configuration: { merchant: { capabilities: { card_payments: { status: "restricted" } } } },
        requirements: { entries: [{ awaiting_action_from: "user", minimum_deadline: { status: "past_due" } }] },
      }),
    ).toEqual({ cardPayments: "restricted", requirementsDue: true });
  });

  it("treats missing parts as not ready", () => {
    expect(accountStatus({})).toEqual({ cardPayments: "inactive", requirementsDue: false });
  });
});

describe("requirementNotes", () => {
  it("lists why card payments are off, then what Stripe still wants", () => {
    expect(
      requirementNotes({
        configuration: {
          merchant: {
            capabilities: {
              card_payments: {
                status: "pending",
                status_details: [{ code: "requirements_pending_verification", resolution: "no_resolution" }],
              },
            },
          },
        },
        requirements: {
          entries: [
            {
              description: "identity.individual.address",
              awaiting_action_from: "stripe",
              minimum_deadline: { status: "currently_due" },
              errors: [{ code: "verification_failed_address_match" }],
            },
          ],
        },
      }),
    ).toEqual([
      { item: "card_payments", from: "no_resolution", status: "requirements_pending_verification", errors: [] },
      {
        item: "identity.individual.address",
        from: "stripe",
        status: "currently_due",
        errors: ["verification_failed_address_match"],
      },
    ]);
    expect(requirementNotes({})).toEqual([]);
  });
});

describe("accountStage", () => {
  it("puts the account in one of four stages", () => {
    expect(accountStage(null)).toBe("not_started");
    expect(accountStage({ cardPayments: "active", requirementsDue: true })).toBe("needs_info");
    expect(accountStage({ cardPayments: "pending", requirementsDue: false })).toBe("in_review");
    expect(accountStage({ cardPayments: "active", requirementsDue: false })).toBe("ready");
  });
});

describe("saleFee", () => {
  it("takes the platform's share, rounded to whole øre", () => {
    expect(saleFee(59_700, 150)).toBe(896);
    expect(saleFee(100, 1)).toBeNull(); // rounds to nothing
    expect(saleFee(59_700, 0)).toBeNull();
  });
});
