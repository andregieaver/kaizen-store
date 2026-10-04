import { describe, expect, it } from "vitest";

import { OWNER_TOOLS } from "./owner-tools";
import { TOOL_PERMISSIONS, mayUseTool, toolKey, toolRefusal } from "./owner-tool-permissions";
import { ROLE_TEMPLATES, isPermissionKey, type PermissionHolder } from "./permissions";

/** The tools that change something: the table must ask a `write` (or the owner) for each, and a `read` for none. */
const CHANGING = new Set([
  "add_order_note", "mark_order_sent", "cancel_booking", "archive_product", "refund_order", "approve_return", "decline_return", "create_discount",
  "set_discount_active", "create_campaign", "set_campaign_active", "set_recommendations", "add_recommendation_rule", "remove_recommendation_rule",
  "set_bonus_program", "adjust_customer_credits", "set_affiliate_program", "block_affiliate", "create_field_group", "set_fields", "email_customer",
  "resend_order_email", "set_stock", "post_to_slack", "draft_experiment", "start_experiment", "stop_experiment", "apply_winner", "unpublish_page",
]);

const owner: PermissionHolder = { role: "owner" };
const admin: PermissionHolder = { role: "admin" };
const template = (key: keyof typeof ROLE_TEMPLATES): PermissionHolder => ({ role: "admin", permissions: ROLE_TEMPLATES[key].permissions });

describe("the AI manager's store tools and what they need", () => {
  it("has a permission for every tool and for nothing else (the table is exhaustive, in both directions)", () => {
    const tools = OWNER_TOOLS.map((tool) => tool.name).sort();
    expect(Object.keys(TOOL_PERMISSIONS).sort()).toEqual(tools);
    for (const name of tools) expect(isPermissionKey(TOOL_PERMISSIONS[name as keyof typeof TOOL_PERMISSIONS]), name).toBe(true);
  });

  it("asks a read for what only looks, a write for what changes, and the owner's key for neither of the lesser", () => {
    for (const tool of OWNER_TOOLS) {
      const key = TOOL_PERMISSIONS[tool.name as keyof typeof TOOL_PERMISSIONS];
      if (CHANGING.has(tool.name)) expect([tool.name, key.endsWith(":write") || key === "owner"]).toEqual([tool.name, true]);
      else expect([tool.name, key.endsWith(":read") || key === "owner"]).toEqual([tool.name, true]);
    }
  });

  it("asks at least a write of the area for every tool that is kept for a yes: a send, a public change or a spend", () => {
    for (const tool of OWNER_TOOLS.filter((t) => t.gate)) {
      const key = TOOL_PERMISSIONS[tool.name as keyof typeof TOOL_PERMISSIONS];
      expect([tool.name, key.endsWith(":write") || key === "owner"]).toEqual([tool.name, true]);
    }
  });

  it("asks the owner's key where the admin page it stands in for is the owner's", () => {
    // Payments, the plan, AI and integrations, the programs' rules: the same pages and actions are the owner's in the admin.
    for (const name of ["set_bonus_program", "set_affiliate_program", "set_recommendations", "post_to_slack", "ai_usage"]) expect(toolKey(name)).toBe("owner");
  });

  it("lets the owner use every tool and a default admin every tool but the owner's", () => {
    for (const tool of OWNER_TOOLS) {
      expect([tool.name, mayUseTool(owner, tool.name)]).toEqual([tool.name, true]);
      expect([tool.name, mayUseTool(admin, tool.name)]).toEqual([tool.name, TOOL_PERMISSIONS[tool.name as keyof typeof TOOL_PERMISSIONS] !== "owner"]);
    }
  });

  it("holds each role to its areas: the orders role refunds, but cannot touch prices, discounts, pages or the owner's tools", () => {
    const orders = template("orders");
    expect(mayUseTool(orders, "refund_order")).toBe(true);
    expect(mayUseTool(orders, "list_customers")).toBe(true);
    for (const name of ["set_stock", "create_discount", "unpublish_page", "email_customer", "set_bonus_program", "ai_usage", "analytics_overview"]) {
      expect([name, mayUseTool(orders, name)]).toEqual([name, false]);
    }
  });

  it("lets a read-only role look and change nothing", () => {
    const readOnly = template("read_only");
    for (const tool of OWNER_TOOLS) {
      const key = TOOL_PERMISSIONS[tool.name as keyof typeof TOOL_PERMISSIONS];
      expect([tool.name, mayUseTool(readOnly, tool.name)]).toEqual([tool.name, key.endsWith(":read") && !CHANGING.has(tool.name) && mayUseTool(readOnly, tool.name)]);
      if (CHANGING.has(tool.name)) expect([tool.name, mayUseTool(readOnly, tool.name)]).toEqual([tool.name, false]);
    }
  });

  it("refuses a tool that is none, for everyone", () => {
    expect(toolKey("make_coffee")).toBeNull();
    expect(mayUseTool(owner, "make_coffee")).toBe(false);
  });

  it("says in words why: the area a role lacks, or that only an owner can", () => {
    expect(toolRefusal("set_stock")).toBe("I can't do that for you: your role has no access to products.");
    expect(toolRefusal("refund_order")).toBe("I can't do that for you: your role has no access to orders.");
    expect(toolRefusal("ai_usage")).toBe("I can't do that for you: only an owner can.");
  });
});
