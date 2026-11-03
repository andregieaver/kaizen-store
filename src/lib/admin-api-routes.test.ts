import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { API_ERRORS, API_POWERS, API_SCOPES, grants, isApiPower, SCOPES_BEFORE_D440 } from "./admin-api";
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "./admin-api-catalogue";
import { SCOPE_TEXT } from "./admin-openapi";
import { notificationsEn } from "./admin-messages/notifications.en";
import { notificationsNb } from "./admin-messages/notifications.nb";
import { OWNER_TOOLS } from "./owner-tools";
import { ADMIN_API, ADMIN_API_BY_NAME, API_ROUTES, bodyProblems, discountBody, errorsOf, fieldUpdateBody, routeOf, ruleUpdateBody, tagBody } from "./admin-api-routes";
import { jsonSchemaOf, pathParams } from "./openapi";
import { isPermissionKey } from "./permission-keys";

const ID = "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d";
const sample = (path: string) => path.replace("{tag}", "vip").replace(/\{\w+\}/g, ID).split("/").filter(Boolean);

/** Writes that only read: an export starts a job of the store's own file, and changes nothing (D440). */
const READS_BY_POST: readonly string[] = ["jobs.product_export"];

/** The Admin API's registry (D438): every operation described once and whole, and the router made from it. */
describe("ADMIN_API", () => {
  it("names each operation once, and each method and path once", () => {
    expect(new Set(ADMIN_API.map((o) => o.name)).size).toBe(ADMIN_API.length);
    expect(new Set(ADMIN_API.map((o) => `${o.method} ${o.path}`)).size).toBe(ADMIN_API.length);
    expect(Object.keys(ADMIN_API_BY_NAME).sort()).toEqual(ADMIN_API.map((o) => o.name).sort());
  });

  it("gives every operation its words, scope, schemas and errors", () => {
    for (const o of ADMIN_API) {
      const where = `${o.method} ${o.path}`;
      expect(o.summary.length, where).toBeGreaterThan(5);
      expect(o.description.length, where).toBeGreaterThan(10);
      expect(o.tag, where).toMatch(/^[A-Z]/);
      expect(API_SCOPES, where).toContain(o.scope);
      // A read needs a read scope (or the write of an area that has none), a change never a read scope (D440: a write, or a power such as
      // `products:publish`); the permission its screen asks for is a read for a read.
      if (o.method === "GET") expect(o.scope.endsWith(":read") || !API_SCOPES.includes(o.scope.replace(/:write$/, ":read") as never), where).toBe(true);
      else expect(o.scope.endsWith(":read"), where).toBe(READS_BY_POST.includes(o.name));
      expect(isPermissionKey(o.permission), where).toBe(true);
      if (o.method !== "GET") expect(o.permission.endsWith(":read"), where).toBe(READS_BY_POST.includes(o.name));
      if ("feature" in o) expect(errorsOf(o), where).toContain("feature_off");
      expect(o.path, where).toMatch(/^(\/[a-z-]+|\/\{\w+\})+$/);
      // The path's parameters are exactly those its zod reads.
      const declared = "params" in o ? Object.keys(o.params.shape).sort() : [];
      expect(declared, where).toEqual(pathParams(o.path).sort());
      // A write sends a body; a read and a delete do not; only reads take a query.
      expect("body" in o, where).toBe(o.method === "POST" || o.method === "PATCH");
      if ("query" in o) expect(o.method, where).toBe("GET");
      // Only a POST makes something (201); a POST that acts on what is there (adjust, publish, send) answers 200.
      if (o.method !== "POST") expect(o.status, where).toBe(200);
      for (const code of o.errors) expect(Object.keys(API_ERRORS), where).toContain(code);
      // Anything with an id can be not found; a body can be invalid; a POST's Idempotency-Key can be in use.
      if (o.path.includes("{")) expect(o.errors, where).toContain("not_found");
      if ("body" in o) expect(o.errors, where).toContain("invalid");
      if (o.method === "POST") expect(o.errors, where).toContain("conflict");
      expect(errorsOf(o).slice(0, 4), where).toEqual(["unauthorized", "forbidden", "rate_limited", "failed"]);
      // Every answer is `{ data }`, a list's with `next`; every schema can be published.
      const answer = jsonSchemaOf(o.response) as { properties: Record<string, unknown> };
      expect(Object.keys(answer.properties), where).toContain("data");
      if ("query" in o && "after" in o.query.shape) expect(Object.keys(answer.properties), where).toContain("next");
      if ("body" in o) expect(() => jsonSchemaOf(o.body), where).not.toThrow();
    }
  });

  it("is what the Apps and API page lists", () => {
    expect(API_ROUTES).toEqual(ADMIN_API.map((o) => ({ method: o.method, path: o.path, scope: o.scope })));
  });
});

describe("routeOf, made from the registry", () => {
  it("routes every operation's own path to it, with its parameters read", () => {
    for (const o of ADMIN_API) {
      const route = routeOf(o.method, sample(o.path));
      expect(route?.name, `${o.method} ${o.path}`).toBe(o.name);
      expect(route?.scope).toBe(o.scope);
      if (o.path.includes("{id}")) expect(route).toMatchObject({ id: ID });
    }
    expect(routeOf("DELETE", ["customers", ID, "tags", "VIP%20customers"])).toEqual({ name: "customers.untag", scope: "customers:write", id: ID, tag: "VIP customers" });
  });

  it("never lets two operations answer the same call", () => {
    for (const a of ADMIN_API) {
      for (const b of ADMIN_API) {
        if (a === b || a.method !== b.method) continue;
        const sa = a.path.split("/");
        const sb = b.path.split("/");
        const overlap = sa.length === sb.length && sa.every((s, i) => s === sb[i] || s.startsWith("{") || sb[i].startsWith("{"));
        // Where a literal meets a parameter, the literal wins (`routeOf()` takes the most literal template).
        if (overlap) expect(routeOf(a.method, sample(a.path))?.name).toBe(a.name);
      }
    }
  });

  it("refuses a malformed escape and an id that is not one", () => {
    expect(routeOf("DELETE", ["customers", ID, "tags", "%E0%A4%A"])).toBeNull();
    expect(routeOf("GET", ["orders", "1042"])).toBeNull();
    expect(routeOf("GET", [])).toBeNull();
  });
});

describe("the bodies the writes take", () => {
  it("take what callers send today, and say what is wrong in the API's words", () => {
    expect(discountBody.safeParse({ code: "API15", kind: "percent", percent: 15 }).success).toBe(true);
    expect(discountBody.safeParse({ code: "SHIP", kind: "free_shipping", usage_limit: null, starts_at: null }).success).toBe(true);
    expect(discountBody.safeParse({ code: "TENOFF", kind: "fixed", amounts: { NO: "100" }, min_subtotals: { NO: "500" }, active: false }).success).toBe(true);
    const empty = discountBody.safeParse({ code: "", kind: "percent" });
    expect(empty.success).toBe(false);
    expect(bodyProblems(empty.error!.issues)).toEqual(["code: Give the code."]);
    expect(bodyProblems(discountBody.safeParse({ code: "X10", kind: "half" }).error!.issues)[0]).toMatch(/^kind: /);
    expect(tagBody.safeParse({ tag: "Wholesale" }).success).toBe(true);
    expect(bodyProblems(tagBody.safeParse({}).error!.issues)[0]).toMatch(/^tag: /);
  });

  it("switch a rule or a question with `enabled` alone, or take the whole of it", () => {
    expect(ruleUpdateBody.parse({ enabled: true })).toEqual({ enabled: true });
    expect(ruleUpdateBody.parse({ name: "Hide flat", effect: { kind: "hide_shipping", options: ["flat"] } })).toMatchObject({ name: "Hide flat", conditions: [] });
    expect(ruleUpdateBody.parse({ name: "Flat", effect: { kind: "order_delivery", options: ["flat"] }, enabled: false })).toMatchObject({ enabled: false });
    expect(fieldUpdateBody.parse({ enabled: false })).toEqual({ enabled: false });
    expect(fieldUpdateBody.parse({ kind: "text", label: { text: "Door code" } })).toMatchObject({ required: false, help: null });
    // The problems of the shape the body came nearest, not "invalid input".
    expect(bodyProblems(ruleUpdateBody.safeParse({ enabled: "yes" }).error!.issues)).toEqual(["enabled: Invalid input: expected boolean, received string"]);
    expect(bodyProblems(ruleUpdateBody.safeParse({ name: "Only a name" }).error!.issues)).toEqual(["effect: Invalid input: expected object, received undefined"]);
  });

  it("reads the update bodies as their handler splits them", () => {
    const { enabled, ...rest } = ruleUpdateBody.parse({ enabled: true });
    expect(enabled).toBe(true);
    expect(Object.keys(rest)).toEqual([]);
    expect(z.toJSONSchema(ruleUpdateBody, { io: "input" })).toHaveProperty("anyOf");
  });
});

/**
 * What each scope allows (D440 review): a token made before D440 held only the twelve scopes of D355, so every operation it could call keeps
 * the scope it had, every write D440 added has a scope none of those twelve is, and what the AI manager asks the owner's yes for is a power.
 */
describe("the scopes a token holds (D440 review)", () => {
  /** The operations of D355 and D438, with the scope each had at 13c1ae79. */
  const BEFORE: Record<string, string> = {
    "products.list": "products:read",
    "products.get": "products:read",
    "products.create": "products:write",
    "products.update": "products:write",
    "inventory.locations": "inventory:read",
    "inventory.levels": "inventory:read",
    "inventory.adjust": "inventory:write",
    "inventory.set": "inventory:write",
    "orders.list": "orders:read",
    "orders.get": "orders:read",
    "orders.fulfil": "orders:write",
    "invoices.ubl": "orders:read",
    "credit_notes.ubl": "orders:read",
    "customers.list": "customers:read",
    "customers.get": "customers:read",
    "customers.tag": "customers:write",
    "customers.untag": "customers:write",
    "discounts.list": "discounts:read",
    "discounts.create": "discounts:write",
    "checkout.rules": "checkout:read",
    "checkout.rule_create": "checkout:write",
    "checkout.rule_update": "checkout:write",
    "checkout.rule_delete": "checkout:write",
    "checkout.fields": "checkout:read",
    "checkout.field_create": "checkout:write",
    "checkout.field_update": "checkout:write",
    "checkout.field_delete": "checkout:write",
  };

  /** Operations that do what an owner tool asks the owner's yes for (`gate` public, send or spend in `OWNER_TOOLS`). */
  const GATED: Record<string, string> = {
    "products.publish": "set_product_status",
    "products.unpublish": "set_product_status",
    "products.unarchive": "set_product_status",
    "products.archive": "archive_product",
    "categories.update": "update_category",
    "categories.delete": "update_category",
    "tags.update": "update_category",
    "tags.delete": "update_category",
    "price_lists.set_prices": "set_price_list_prices",
    "drafts.send": "send_draft_order",
    "drafts.decline": "decline_quote",
    "returns.approve": "approve_return",
    "returns.decline": "decline_return",
    "orders.refund": "refund_order",
    "discounts.disable": "set_discount_active",
    "gift_cards.issue": "issue_gift_card",
    "pages.publish": "publish_page",
    "articles.publish": "publish_page",
    "content.entry_publish": "publish_entry",
  };

  it("keeps every operation a token could call before D440 on the scope it had", () => {
    for (const [name, scope] of Object.entries(BEFORE)) expect(ADMIN_API_BY_NAME[name as keyof typeof ADMIN_API_BY_NAME]?.scope, name).toBe(scope);
    expect(SCOPES_BEFORE_D440).toEqual([...new Set(Object.values(BEFORE))]);
    // Nothing a token made then holds lets it call an operation D440 added, beyond reading its own area.
    for (const o of ADMIN_API) {
      if (o.name in BEFORE) continue;
      if (o.method === "GET" || READS_BY_POST.includes(o.name)) expect(o.scope.endsWith(":read") || isApiPower(o.scope) || !SCOPES_BEFORE_D440.includes(o.scope), o.name).toBe(true);
      else expect(SCOPES_BEFORE_D440, o.name).not.toContain(o.scope);
    }
  });

  it("puts what the AI manager asks the owner's yes for behind a power, never a plain write", () => {
    const tools = new Map<string, string | undefined>(OWNER_TOOLS.map((t) => [t.name, t.gate]));
    for (const [name, tool] of Object.entries(GATED)) {
      expect(["public", "send", "spend"], `${name}: ${tool}`).toContain(tools.get(tool));
      expect(isApiPower(ADMIN_API_BY_NAME[name as keyof typeof ADMIN_API_BY_NAME].scope), name).toBe(true);
    }
    for (const power of API_POWERS) expect(SCOPES_BEFORE_D440).not.toContain(power);
  });

  it("lets every scope of an area read it, and no read change anything", () => {
    expect(grants(["products:publish"], "products:read")).toBe(true);
    expect(grants(["orders:send"], "orders:read")).toBe(true);
    expect(grants(["products:write"], "products:read")).toBe(true);
    expect(grants(["products:read"], "products:write")).toBe(false);
    expect(grants(["products:write"], "products:manage")).toBe(false);
    expect(grants(["products:write"], "products:publish")).toBe(false);
    expect(grants(["orders:write"], "orders:manage")).toBe(false);
    expect(grants(["customers:write"], "customers:manage")).toBe(false);
    expect(grants(["customers:manage"], "customers:email")).toBe(false);
    expect(grants(["discounts:write"], "discounts:publish")).toBe(false);
    expect(grants(["content:write"], "content:publish")).toBe(false);
    expect(grants(["orders:refund"], "products:read")).toBe(false);
  });

  it("says in the owner's words what each scope allows, in every language, and the old ones as before", () => {
    for (const words of [notificationsEn.apiTokens.scopeWords, notificationsNb.apiTokens.scopeWords]) {
      expect(Object.keys(words).sort()).toEqual([...API_SCOPES].sort());
    }
    for (const scope of API_SCOPES) expect(SCOPE_TEXT[scope].length, scope).toBeGreaterThan(10);
    // The writes a token could hold before D440 read as they did then.
    expect(notificationsEn.apiTokens.scopeWords["products:write"]).toBe("Make products and change drafts");
    expect(notificationsEn.apiTokens.scopeWords["orders:write"]).toBe("Record parcels with tracking");
    expect(notificationsEn.apiTokens.scopeWords["customers:write"]).toBe("Tag customers");
    expect(notificationsEn.apiTokens.scopeWords["discounts:write"]).toBe("Make discount codes");
  });

  it("gives picture uploads a bucket of their own, whose limit is the API's", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261103201100_api_review.sql"), "utf8");
    const bucket = /VALUES \('api-uploads', 'api-uploads', false, (\d+), ARRAY\[([^\]]+)\]\)/.exec(sql);
    expect(bucket).not.toBeNull();
    expect(Number(bucket![1])).toBe(UPLOAD_MAX_BYTES);
    expect(bucket![2].split(",").map((t) => t.trim().replace(/'/g, "")).sort()).toEqual([...UPLOAD_TYPES].sort());
  });
});
