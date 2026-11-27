import { describe, expect, it } from "vitest";

import { incidentArea, incidentState } from "./store-incidents";

describe("a problem as a store's owner reads it (D895 IA-18)", () => {
  it("names where it was in the owner's words, and where it stands", () => {
    expect(incidentArea("/s/:store/no/products/:id")).toBe("store");
    expect(incidentArea("/admin/:store/orders")).toBe("admin");
    expect(incidentArea("/api/cron/cart-reminders")).toBe("background");
    expect(incidentArea("/api/stripe/webhook")).toBe("connection");
    expect(incidentArea(null)).toBe("other");
    expect(["open", "approved", "claimed", "needs_owner"].map(incidentState)).toEqual(["fixing", "fixing", "fixing", "fixing"]);
    expect(incidentState("fixed")).toBe("watching");
    expect(incidentState("done")).toBe("fixed");
  });
});
