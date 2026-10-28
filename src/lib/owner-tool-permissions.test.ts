import { describe, expect, it } from "vitest";

import { OWNER_TOOLS } from "./owner-tools";
import { TOOL_PERMISSIONS, mayUseTool, toolKey, toolRefusal } from "./owner-tool-permissions";
import { ROLE_TEMPLATES, isPermissionKey, type PermissionHolder } from "./permissions";

/** The tools that change something: the table must ask a `write` (or the owner) for each, and a `read` for none. */
const CHANGING = new Set([
  "add_order_note", "mark_order_sent", "cancel_booking", "archive_product", "refund_order", "approve_return", "decline_return", "create_discount",
  "set_discount_active", "create_campaign", "set_campaign_active", "set_recommendations", "add_recommendation_rule", "remove_recommendation_rule",
  "set_bonus_program", "adjust_customer_credits", "set_affiliate_program", "block_affiliate", "create_field_group", "set_fields", "email_customer",
  "resend_order_email", "set_stock", "set_backorder", "post_to_slack", "draft_experiment", "start_experiment", "stop_experiment", "apply_winner", "unpublish_page", "add_redirect",
  "save_search_synonym", "save_search_rule", "delete_search_merchandising", "set_market_price_rule", "save_producer_registration", "moderate_blog_comment", "schedule_article", "schedule_site_change",
  "save_entry", "publish_entry", "unpublish_entry", "save_content_type",
  "tag_orders", "archive_orders", "create_draft_order", "send_draft_order", "set_feature",
  "draft_broadcast", "send_broadcast", "tag_customer", "switch_email_automation", "issue_gift_card", "save_research_note", "compare_options", "set_brand", "design_look", "make_brand_marks",
  "add_support_note", "reply_to_support", "end_support_conversation",
  "invite_staff", "change_staff_role", "remove_staff", "change_plan", "end_plan", "change_order", "propose_exchange", "process_exchange", "log_time", "issue_work_invoice",
  "create_product", "update_product", "set_prices", "set_product_status", "write_product_texts", "update_category",
  "build_page", "edit_page", "publish_page", "set_page_place", "save_menu", "set_header_footer",
  "set_store_details", "set_countries", "set_languages", "set_currencies", "set_flat_shipping", "save_shipping_method", "open_store",
  "add_theme", "make_theme_live",
  "save_report",
  "set_target",
  "buy_domain", "renew_domain", "set_domain_renewal", "change_dns", "set_up_email", "verify_domain_for", "undo_dns_change", "switch_nameservers", "connect_domain",
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
