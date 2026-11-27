import { describe, expect, it } from "vitest";

import { drainErrors, maskMessage, routeOf, storePath } from "./drain-errors";

/** Runtime errors from the log drain into the incident log (D895 IA-17): grouped by route and name, never a person's data. */
const line = (over: Record<string, unknown>) => ({
  source: "lambda",
  environment: "production",
  level: "error",
  deploymentId: "dpl_abc",
  path: "/s/kari-shop/no/products/3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c?ref=mail",
  proxy: { clientIp: "120.75.16.101", userAgent: ["Mozilla"], path: "/s/kari-shop/no/products/x?ref=mail" },
  message: "TypeError: Cannot read properties of undefined (reading 'price') for kari@example.com",
  ...over,
});

describe("runtime errors from the drain", () => {
  it("names a route by its shape, never a store, an id or a query", () => {
    expect(routeOf("/s/kari-shop/no/products/3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c?ref=mail")).toBe("/s/:store/no/products/:id");
    expect(routeOf("/admin/kari-shop/orders/10023")).toBe("/admin/:store/orders/:id");
    expect(routeOf("/admin/platform/incidents")).toBe("/admin/platform/incidents");
    expect(storePath("/admin/kari-shop/orders/1")).toBe("/s/kari-shop");
    expect(storePath("/s/kari-shop/no")).toBe("/s/kari-shop/no");
    expect(maskMessage("failed for kari@example.com order 1002345 id 3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c")).toBe("failed for [email] order # id :id");
  });

  it("groups production's function errors by route and name, with a count, and keeps no IP, agent or person", () => {
    const errors = drainErrors([
      line({}),
      line({ path: "/s/other-shop/no/products/9f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c" }),
      line({ level: "info" }),
      line({ environment: "preview" }),
      line({ source: "static" }),
      line({ level: "info", path: "/api/cron/dispatch", message: JSON.stringify({ level: "error", event: "cron.job_failed", job: "x", errorName: "Error", errorMessage: "boom 123456" }) }),
    ]);
    expect(errors).toEqual([
      {
        fingerprint: "runtime:/s/:store/no/products/:id:typeerror",
        kind: "error",
        title: "Runtime error: TypeError on /s/:store/no/products/:id",
        route: "/s/:store/no/products/:id",
        name: "TypeError",
        message: "TypeError: Cannot read properties of undefined (reading 'price') for [email]",
        count: 2,
        deployment: "dpl_abc",
        places: [
          { host: "", path: "/s/kari-shop/no/products/3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c" },
          { host: "", path: "/s/other-shop/no/products/9f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c" },
        ],
      },
      {
        fingerprint: "runtime:/api/cron/dispatch:cron.job_failed",
        kind: "error",
        title: "Runtime error: cron.job_failed on /api/cron/dispatch",
        route: "/api/cron/dispatch",
        name: "cron.job_failed",
        message: "Error boom #",
        count: 1,
        deployment: "dpl_abc",
        places: [{ host: "", path: "/api/cron/dispatch" }],
      },
    ]);
    // The places only find the stores; nothing else of the line is kept.
    const text = JSON.stringify(errors.map((e) => ({ ...e, places: [] })));
    for (const word of ["120.75", "Mozilla", "kari", "ref=mail"]) expect(text, word).not.toContain(word);
  });

  it("counts Node's own process warnings as warnings named by their code, not errors (incident 1af5e1d0)", () => {
    const message = "(node:8) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications.";
    const [warning] = drainErrors([line({ path: "/api/cron/cart-reminders", message })]);
    expect(warning).toMatchObject({
      fingerprint: "runtime:/api/cron/cart-reminders:dep0169",
      kind: "warning",
      title: "Runtime warning: DEP0169 on /api/cron/cart-reminders",
      name: "DEP0169",
    });
    expect(drainErrors([line({ message: "(node:8) ExperimentalWarning: x" })])[0]).toMatchObject({ kind: "warning", name: "ExperimentalWarning" });
  });

  it("leaves out the incident log's own lines, so it never feeds itself", () => {
    const own = JSON.stringify({ level: "error", event: "incidents.log_failed", errorMessage: "x" });
    expect(drainErrors([line({ message: own })])).toEqual([]);
  });
});
