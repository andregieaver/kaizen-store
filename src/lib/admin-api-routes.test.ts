import { describe, expect, it } from "vitest";
import { z } from "zod";

import { API_ERRORS, API_SCOPES } from "./admin-api";
import { ADMIN_API, ADMIN_API_BY_NAME, API_ROUTES, bodyProblems, discountBody, errorsOf, fieldUpdateBody, routeOf, ruleUpdateBody, tagBody } from "./admin-api-routes";
import { jsonSchemaOf, pathParams } from "./openapi";
import { isPermissionKey } from "./permission-keys";

const ID = "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d";
const sample = (path: string) => path.replace("{tag}", "vip").replace(/\{\w+\}/g, ID).split("/").filter(Boolean);

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
      else expect(o.scope.endsWith(":read"), where).toBe(false);
      expect(isPermissionKey(o.permission), where).toBe(true);
      if (o.method !== "GET") expect(o.permission.endsWith(":read"), where).toBe(false);
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
