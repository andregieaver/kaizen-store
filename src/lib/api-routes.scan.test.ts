import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ADMIN_API, routeOf } from "./admin-api-routes";
import { STOREFRONT_ROUTES } from "./storefront-api";

/**
 * The route files and the registries agree (D438): every `route.ts` under `src/app/api/admin/v1` and `src/app/api/storefront/v1` is an
 * operation of `ADMIN_API` or `STOREFRONT_ROUTES` (or the contract document itself), and every operation has its route, so the published
 * contract is what is served. A new route file fails here until its entry is in the registry, and the other way round.
 */
const root = path.resolve(__dirname, "../..");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

/** A route file's path in the registry's words (`[handle]` is `{}`), and the methods it exports. */
function served(base: string, file: string): { path: string; methods: string[] } {
  const rel = path.relative(base, path.dirname(file)).split(path.sep).filter(Boolean);
  const text = readFileSync(file, "utf8");
  const methods = METHODS.filter((m) => new RegExp(`export (?:async function|const|function) ${m}\\b`).test(text));
  return { path: `/${rel.map((s) => (/^\[.+\]$/.test(s) ? "{}" : s)).join("/")}`, methods };
}

const shape = (p: string) => p.replace(/\{\w+\}/g, "{}");

describe("the Admin API's route files (D438)", () => {
  const base = path.join(root, "src/app/api/admin/v1");
  const files = routeFiles(base).map((f) => served(base, f));

  it("are the catch-all that routes by ADMIN_API, and the contract document", () => {
    expect(files.map((f) => f.path).sort()).toEqual(["/openapi.json", "/{}"]);
    expect(files.find((f) => f.path === "/openapi.json")?.methods).toEqual(["GET"]);
  });

  it("serve every operation through the catch-all, with its method exported", () => {
    const methods = files.find((f) => f.path === "/{}")!.methods;
    for (const o of ADMIN_API) {
      expect(methods, `${o.method} ${o.path}`).toContain(o.method);
      const sample = o.path.replace(/\{id\}/g, "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d").replace("{tag}", "vip").split("/").filter(Boolean);
      expect(routeOf(o.method, sample)?.name, `${o.method} ${o.path}`).toBe(o.name);
    }
    // The catch-all routes only what the registry names: a method it exports that no operation uses would answer only 404s.
    expect(methods.filter((m) => !ADMIN_API.some((o) => o.method === m))).toEqual([]);
  });

  it("route by the registry alone", () => {
    const text = readFileSync(path.join(base, "[...path]/route.ts"), "utf8");
    expect(text).toContain('import { routeOf } from "@/lib/admin-api-routes"');
  });
});

describe("the storefront API's route files (D438)", () => {
  const base = path.join(root, "src/app/api/storefront/v1");
  const files = routeFiles(base).map((f) => served(base, f));
  const listed = STOREFRONT_ROUTES.map((r) => `${r.method} /{}${shape(r.path)}`).sort();

  it("are each a route of STOREFRONT_ROUTES, and every route has its file", () => {
    const servedRoutes = files.filter((f) => f.path !== "/openapi.json").flatMap((f) => f.methods.map((m) => `${m} ${f.path}`));
    expect(servedRoutes.sort()).toEqual(listed);
  });

  it("publish the contract document beside the store's routes", () => {
    expect(files.find((f) => f.path === "/openapi.json")?.methods).toEqual(["GET"]);
  });
});
