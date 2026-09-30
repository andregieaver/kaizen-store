import { describe, expect, it } from "vitest";

import { COPY_GROUPS, COPY_RULES, SECRET_TABLES, copyTables } from "./store-copy-rules";

describe("what a store copy does with each table", () => {
  it("gives every table a known group and a reason", () => {
    for (const [table, rule] of Object.entries(COPY_RULES)) {
      expect([table, rule.group in COPY_GROUPS]).toEqual([table, true]);
      expect([table, rule.note.length >= 8]).toEqual([table, true]);
    }
  });

  it("never copies a table that holds a secret, a credential, a session or another person's right", () => {
    for (const table of SECRET_TABLES) expect([table, COPY_RULES[table]?.group]).toEqual([table, "never"]);
  });

  it("never copies Work, payments, invoices, subscriptions, carts or logs", () => {
    for (const table of Object.keys(COPY_RULES)) {
      if (
        /^(work_|payment|refund|invoice|credit_note|subscription|carts?$|cart_lines|wishlist|standing_|shipments|webhook_events|audit_log)/.test(
          table,
        )
      ) {
        expect([table, COPY_RULES[table].group]).toEqual([
          table,
          table === "payment_methods" || table === "payment_providers" ? "settings" : "never",
        ]);
      }
    }
  });

  it("copies customers and orders only as their own groups", () => {
    expect(copyTables("people")).toEqual(["customers", "email_opt_outs"]);
    expect(copyTables("orders")).toEqual(["order_events", "order_lines", "orders"]);
    expect(copyTables("pages")).toEqual(["pages"]);
  });

  it("lists the products' tables together", () => {
    expect(copyTables("catalogue")).toEqual(
      expect.arrayContaining([
        "products",
        "product_variants",
        "prices",
        "inventory_levels",
        "selling_plans",
        "product_media",
      ]),
    );
  });
});
