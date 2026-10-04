import { describe, expect, it } from "vitest";

import { AUDIT_AREA_KEYS } from "./audit";
import { AUDIT_AREA_LABELS, actionLabel, activityQuery, changeLine, fieldLabel, valueText } from "./activity-text";

describe("the activity log's words", () => {
  it("names every area the log can hold", () => {
    for (const area of AUDIT_AREA_KEYS) expect(AUDIT_AREA_LABELS[area], area).toBeTruthy();
  });

  it("reads an action as a filter option", () => {
    expect(actionLabel("product.price_changed")).toBe("Product: price changed");
    expect(actionLabel("store.two_step_required")).toBe("Store: two step required");
    expect(actionLabel("activity.exported")).toBe("Activity: exported");
    expect(actionLabel("billing")).toBe("Billing");
  });

  it("reads a field's name", () => {
    expect(fieldLabel("requireTwoStep")).toBe("Require two step");
    expect(fieldLabel("vat_category")).toBe("Vat category");
    expect(fieldLabel("title")).toBe("Title");
  });

  it("reads a value", () => {
    expect(valueText(null)).toBe("(none)");
    expect(valueText("")).toBe("(none)");
    expect(valueText(true)).toBe("yes");
    expect(valueText(false)).toBe("no");
    expect(valueText(["a", "b"])).toBe("a, b");
    expect(valueText([])).toBe("(none)");
    expect(valueText(1990)).toBe("1990");
    expect(valueText({ a: 1 })).toBe('{"a":1}');
  });

  it("shows a changed field as from and to, and a field with no recorded value as changed only", () => {
    expect(changeLine("price", { from: 1000, to: 1200 })).toEqual({ label: "Price", from: "1000", to: "1200" });
    expect(changeLine("note", { changed: true })).toEqual({ label: "Note", from: null, to: null });
  });

  it("builds an address with only the filters that are set", () => {
    expect(activityQuery({})).toBe("");
    expect(activityQuery({ area: "products", person: "", from: "2026-10-01", before: 42 })).toBe("?area=products&from=2026-10-01&before=42");
    expect(activityQuery({ action: "a b" })).toBe("?action=a+b");
  });
});
