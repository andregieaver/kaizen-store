import { describe, expect, it } from "vitest";

import { alertAction, askedAlert, CAMPAIGN_PATH, checkupAction, REORDER_PATH } from "./briefing-actions";

/** The briefing's one-press actions (D416). */

describe("the briefing's one-press actions", () => {
  it("prepares a reorder for stock running out, a campaign for customers coming back, and asks the AI manager about a change", () => {
    expect(alertAction({ id: "stockout", href: "/analytics/inventory" })).toEqual({ kind: "reorder", href: REORDER_PATH });
    expect(alertAction({ id: "returning-high", href: "/analytics/customers" })).toEqual({ kind: "campaign", href: CAMPAIGN_PATH });
    for (const id of ["conversion-drop", "revenue-weekday", "refund-rate", "cac-up", "checkout-abandonment", "discount-creep", "target-behind"]) {
      expect(alertAction({ id, href: "/analytics" })).toEqual({ kind: "ask", href: `?ask=${id}` });
    }
    // The rest keep their own page.
    expect(alertAction({ id: "best-day", href: "analytics" })).toEqual({ kind: "open", href: "/analytics" });
    expect(alertAction({ id: "cost-coverage", href: "/products" })).toEqual({ kind: "open", href: "/products" });
  });

  it("prepares a reorder from the checkup's stock findings, and opens the page of the others", () => {
    expect(checkupAction({ key: "restock", page: "/inventory" })).toEqual({ kind: "reorder", href: REORDER_PATH });
    expect(checkupAction({ key: "stock_low", page: "/inventory" })).toEqual({ kind: "reorder", href: REORDER_PATH });
    expect(checkupAction({ key: "late_orders", page: "/orders?view=to_send" })).toEqual({ kind: "open", href: "/orders?view=to_send" });
  });

  it("only links to pages, never to an action that does something by being opened", () => {
    expect(REORDER_PATH.startsWith("/inventory/purchase-orders")).toBe(true);
    expect(CAMPAIGN_PATH.startsWith("/broadcasts/new")).toBe(true);
  });

  it("reads an alert id from an address only when it is one of the rules' shape", () => {
    expect(askedAlert("conversion-drop")).toBe("conversion-drop");
    expect(askedAlert("<script>")).toBeNull();
    expect(askedAlert(["a"])).toBeNull();
    expect(askedAlert("x".repeat(41))).toBeNull();
  });
});
