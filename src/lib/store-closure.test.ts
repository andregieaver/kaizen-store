import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS } from "./permission-keys";
import {
  NO_OBLIGATIONS,
  REOPEN_DAYS,
  allowedWhenNotOpen,
  cleanReason,
  closureBlockers,
  closureWarnings,
  confirmationMatches,
  keyAllowedWhenNotOpen,
  ownerMayReopen,
  reopenDeadline,
} from "./store-closure";

describe("what blocks closing a store", () => {
  it("is nothing for a store with nothing open", () => {
    expect(closureBlockers(NO_OBLIGATIONS)).toEqual([]);
  });

  it("names paid orders still to send, running subscriptions and running delivery lists, in the singular and the plural", () => {
    expect(closureBlockers({ ...NO_OBLIGATIONS, paidUnshipped: 1 })[0]).toMatch(/^1 paid order has goods still to send\. Send it or cancel and refund it\.$/);
    expect(closureBlockers({ ...NO_OBLIGATIONS, paidUnshipped: 3 })[0]).toMatch(/^3 paid orders have goods still to send\. Send them or cancel and refund them\.$/);
    expect(closureBlockers({ ...NO_OBLIGATIONS, runningSubscriptions: 2 })[0]).toMatch(/^2 subscriptions are still running/);
    expect(closureBlockers({ ...NO_OBLIGATIONS, runningDeliveries: 1 })[0]).toMatch(/^1 weekly delivery list is still running/);
    expect(closureBlockers({ ...NO_OBLIGATIONS, paidUnshipped: 1, runningSubscriptions: 1, runningDeliveries: 1 })).toHaveLength(3);
  });

  it("does not let waiting checkouts, bookings, returns, a plan or domains stop it", () => {
    expect(closureBlockers({ ...NO_OBLIGATIONS, openCheckouts: 4, futureBookings: 2, openReturns: 1, livePlan: true, domains: 1 })).toEqual([]);
  });
});

describe("what is only worth a warning", () => {
  it("always reminds about Stripe's balance and says nothing else for an empty store", () => {
    const warnings = closureWarnings(NO_OBLIGATIONS);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Stripe/);
  });

  it("says what closing does to waiting orders, plan and domains, and what it leaves alone", () => {
    const text = closureWarnings({ ...NO_OBLIGATIONS, openCheckouts: 2, futureBookings: 1, openReturns: 3, livePlan: true, domains: 2 }).join("\n");
    expect(text).toMatch(/2 orders are waiting for payment\. Closing cancels them/);
    expect(text).toMatch(/1 booking is still to come\. Closing does not cancel it/);
    expect(text).toMatch(/3 returns are still open/);
    expect(text).toMatch(/Kaizen plan ends when the period you have paid for is over/);
    expect(text).toMatch(/2 domains of the store's own are released/);
  });
});

describe("reopening", () => {
  const closed = new Date("2026-10-01T12:00:00Z");

  it("is open to the owner for thirty days after closing, to the minute", () => {
    expect(REOPEN_DAYS).toBe(30);
    expect(reopenDeadline(closed).toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(ownerMayReopen("closed", closed, new Date("2026-10-31T12:00:00Z"))).toBe(true);
    expect(ownerMayReopen("closed", closed, new Date("2026-10-31T12:00:01Z"))).toBe(false);
  });

  it("is never the owner's for a suspended store, a store that is open, or a closed one with no date", () => {
    expect(ownerMayReopen("suspended", null, new Date("2026-10-02T00:00:00Z"))).toBe(false);
    expect(ownerMayReopen("active", null, new Date("2026-10-02T00:00:00Z"))).toBe(false);
    expect(ownerMayReopen("closed", null, new Date("2026-10-02T00:00:00Z"))).toBe(false);
  });
});

describe("the typed confirmation", () => {
  it("is the store's address, trimmed and in any case, and nothing else", () => {
    expect(confirmationMatches("kaffe", "kaffe")).toBe(true);
    expect(confirmationMatches("  Kaffe ", "kaffe")).toBe(true);
    expect(confirmationMatches("kaffe.kaizen.shop", "kaffe")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
    expect(confirmationMatches("kaff", "kaffe")).toBe(false);
  });
});

describe("a reason", () => {
  it("is trimmed text of a sensible length", () => {
    expect(cleanReason("  Not  paying   the plan ")).toBe("Not paying the plan");
    expect(cleanReason("no")).toBeNull();
    expect(cleanReason("x".repeat(501))).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
  });
});

describe("what a member may do in a store that is not open", () => {
  it("is to read and handle what already happened, and nothing that sells or publishes", () => {
    for (const key of ["orders:read", "orders:write", "customers:read", "customers:write", "analytics:read", "analytics:write", "billing:read", "staff:read", "owner"] as const) {
      expect(allowedWhenNotOpen(key), key).toBe(true);
    }
    for (const key of ["products:write", "marketing:write", "website:write", "settings:write", "settings:read", "bookings:write", "billing:write", "staff:write"] as const) {
      expect(allowedWhenNotOpen(key), key).toBe(false);
    }
  });

  it("names only keys that exist, so a renamed area cannot quietly lock everyone out or in", () => {
    const known = new Set<string>(PERMISSION_KEYS);
    for (const key of ["orders:read", "orders:write", "customers:read", "customers:write", "analytics:read", "analytics:write", "billing:read", "staff:read", "owner"]) {
      expect(known.has(key), key).toBe(true);
    }
  });

  it("offers a page that needs no key", () => {
    expect(keyAllowedWhenNotOpen(null)).toBe(true);
    expect(keyAllowedWhenNotOpen("products:read")).toBe(false);
  });
});
