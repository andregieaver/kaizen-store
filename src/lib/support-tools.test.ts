import { describe, expect, it } from "vitest";

import { ACTION_KINDS, actionExpiry, CUSTOMER_ACTION_KINDS, readActionArgs, STAFF_REQUEST_KINDS } from "./support-actions";
import { MESSAGE_MAX, TRANSCRIPT_DAYS, TRANSCRIPT_DAYS_DEFAULT } from "./support-rules";
import { EXCHANGE_STATE_WORDS, exchangeStateWords, KAIZEN_SUPPORT_TOOLS, SUPPORT_TOOLS } from "./support-tools";

describe("the support AI's tools and actions (D216, 4.3, 4.4)", () => {
  it("names every tool once, with a description and an input", () => {
    for (const list of [SUPPORT_TOOLS, KAIZEN_SUPPORT_TOOLS]) {
      const names = list.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      for (const tool of list) {
        expect(tool.description.length, tool.name).toBeGreaterThan(20);
        expect(tool.input.safeParse(undefined).success, tool.name).toBe(false);
      }
    }
  });

  it("asks for a signed-in customer before any tool reads or proposes something of theirs", () => {
    for (const name of ["my_orders", "order_details", "return_options", "my_bookings", "my_subscriptions", "my_boxes", "bonus_balance", "propose_action"]) {
      expect(SUPPORT_TOOLS.find((t) => t.name === name)?.needs.signedIn, name).toBe(true);
    }
  });

  it("keeps customer actions and staff requests apart, never a withdrawal or a refund the customer runs", () => {
    expect(ACTION_KINDS).toEqual([...CUSTOMER_ACTION_KINDS, ...STAFF_REQUEST_KINDS]);
    expect(CUSTOMER_ACTION_KINDS.some((k) => /withdraw|refund|credit|code/.test(k))).toBe(false);
    expect(STAFF_REQUEST_KINDS).toContain("refund");
  });

  it("checks a kind's arguments", () => {
    const booking = "6f1e4c2a-1b2c-4d3e-8f90-123456789abc";
    expect(readActionArgs("booking.cancel", { bookingId: booking })).toEqual({ bookingId: booking });
    expect(readActionArgs("booking.cancel", { bookingId: "nope" })).toBeNull();
    expect(readActionArgs("subscription.pause", { subscriptionId: booking, periods: 4 })).toBeNull();
    expect(readActionArgs("refund", { orderNumber: "1042" })).toEqual({ orderNumber: "1042" });
    expect(readActionArgs("withdraw", {})).toBeNull();
  });

  it("lets a customer's proposal expire after 30 minutes, and a request never", () => {
    const at = new Date("2026-10-13T12:00:00Z");
    expect(actionExpiry("booking.cancel", at)?.toISOString()).toBe("2026-10-13T12:30:00.000Z");
    expect(actionExpiry("refund", at)).toBeNull();
  });

  it("pins the numbers the database checks too", () => {
    expect(MESSAGE_MAX).toEqual({ customer: 1000, ai: 2000, agent: 4000, note: 2000, partner: 3000, system: 0 });
    expect(TRANSCRIPT_DAYS).toEqual([30, 60, 90]);
    expect(TRANSCRIPT_DAYS_DEFAULT).toBe(90);
  });
});

describe("exchangeStateWords (D239)", () => {
  it("has words for every exchange status the customer can be in, none for a draft or an unknown one, and never an amount", async () => {
    const { EXCHANGE_STATUSES } = await import("./exchange-status");
    for (const status of EXCHANGE_STATUSES) {
      if (status === "draft") expect(exchangeStateWords(status)).toBeNull();
      else expect(exchangeStateWords(status), status).toBeTruthy();
    }
    expect(exchangeStateWords("nonsense")).toBeNull();
    expect(exchangeStateWords(null)).toBeNull();
    for (const words of Object.values(EXCHANGE_STATE_WORDS)) expect(words).not.toMatch(/\d/);
  });
});
