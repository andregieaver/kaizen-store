import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { afterEach, describe, expect, it, vi } from "vitest";

import { marketPath, storeBase, storeDomain, storeHome, storeHref, storeOrigin, storeSiteUrl } from "./paths";
import { storeHostRoutes, type HostRedirect, type HostRewrite } from "./store-hosts";

afterEach(() => vi.unstubAllEnvs());

/** Where a request ends up, matched as Next.js matches its routes: redirects first, then rewrites. */
function route(routes: ReturnType<typeof storeHostRoutes>, host: string, pathname: string) {
  const req = { headers: { host } } as never;
  const apply = (rule: HostRedirect | HostRewrite, from = pathname) => {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true })(from);
    if (!params) return null;
    const hasParams = matchHas(req, {}, rule.has, "missing" in rule ? rule.missing : undefined);
    if (!hasParams) return null;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: { ...params, ...hasParams },
      query: {},
    });
    const { protocol, hostname, port, pathname: to } = parsedDestination;
    return hostname ? `${protocol}//${hostname}${port ? `:${port}` : ""}${to || "/"}` : to;
  };
  for (const rule of routes.redirects) {
    const to = apply(rule);
    if (to) return { redirect: to };
  }
  // Rewrites before files apply in turn, each to the path the one before left.
  let rewritten: string | null = null;
  for (const rule of routes.rewrites) {
    const to = apply(rule, rewritten ?? pathname);
    if (to) rewritten = to;
  }
  return rewritten ? { rewrite: rewritten } : {};
}

describe("stores on their own hosts (P7)", () => {
  it("changes nothing until the store domain is set", () => {
    expect(storeDomain()).toBeNull();
    expect(storeHostRoutes(null, "https://kaizenstore.cloud")).toEqual({ redirects: [], rewrites: [] });
    expect(storeBase("demo")).toBe("/s/demo");
    expect(storeHome("demo")).toBe("/s/demo");
    expect(marketPath("demo", "no", "/cart")).toBe("/s/demo/no/cart");
    expect(storeOrigin("demo")).toBeNull();
    expect(storeHref("demo", marketPath("demo", "no"))).toBe("/s/demo/no");
    expect(storeSiteUrl("demo")).toBe("http://localhost:3000");
  });

  it("links inside a store stay on its host; links from elsewhere lead there", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "KaizenStores.com");
    expect(storeDomain()).toBe("kaizenstores.com");
    expect(storeBase("demo")).toBe("");
    expect(storeHome("demo")).toBe("/");
    expect(marketPath("demo", "no", "/cart")).toBe("/no/cart");
    expect(storeOrigin("demo")).toBe("https://demo.kaizenstores.com");
    expect(storeHref("demo", storeBase("demo"))).toBe("https://demo.kaizenstores.com");
    expect(storeHref("demo", marketPath("demo", "no", "/cookies"))).toBe("https://demo.kaizenstores.com/no/cookies");
    expect(storeSiteUrl("demo")).toBe("https://demo.kaizenstores.com");

    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "localhost:3000");
    expect(storeOrigin("demo")).toBe("http://demo.localhost:3000");

    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "https://kaizenstores.com/");
    expect(() => storeDomain()).toThrow(/host name/);
  });

  it("serves each store's host from its pages, and nothing else of Kaizen's there", () => {
    const routes = storeHostRoutes("kaizenstores.com", "https://kaizenstore.cloud");
    const store = (path: string) => route(routes, "demo.kaizenstores.com", path);
    expect(store("/")).toEqual({ rewrite: "/s/demo" });
    expect(store("/no")).toEqual({ rewrite: "/s/demo/no" });
    expect(store("/no/p/demo-keramikkopp")).toEqual({ rewrite: "/s/demo/no/p/demo-keramikkopp" });
    expect(store("/robots.txt")).toEqual({ rewrite: "/s/demo/robots.txt" });
    expect(store("/og.png")).toEqual({ rewrite: "/s/demo/og.png" });
    // Kaizen's own pages are the store's paths there, so the admin is not reachable.
    expect(store("/admin")).toEqual({ rewrite: "/s/demo/admin" });
    expect(store("/admin/demo/products")).toEqual({ rewrite: "/s/demo/admin/demo/products" });
    // Shared: Next.js's files, the API (consent log, fonts), public pictures.
    expect(store("/_next/static/chunks/app.js")).toEqual({});
    expect(store("/api/consent")).toEqual({});
    expect(store("/api/fonts/css/lora")).toEqual({});
    expect(store("/demo/logo.svg")).toEqual({});
    expect(store("/kaizen/favicon.ico")).toEqual({});
    // A store's icon is its own (D62).
    expect(store("/favicon.ico")).toEqual({ rewrite: "/s/demo/favicon.ico" });
    // A path that only starts like a shared one is the store's.
    expect(store("/apis")).toEqual({ rewrite: "/s/demo/apis" });
  });

  it("moves store addresses on Kaizen's host to the store's, and the bare domain to Kaizen", () => {
    const routes = storeHostRoutes("kaizenstores.com", "https://kaizenstore.cloud");
    const kaizen = (path: string) => route(routes, "kaizenstore.cloud", path);
    expect(kaizen("/s/demo")).toEqual({ redirect: "https://demo.kaizenstores.com/" });
    expect(kaizen("/s/demo/no/p/demo-keramikkopp")).toEqual({ redirect: "https://demo.kaizenstores.com/no/p/demo-keramikkopp" });
    expect(kaizen("/")).toEqual({});
    expect(kaizen("/admin")).toEqual({});
    expect(route(routes, "kaizenstores.com", "/pricing")).toEqual({ redirect: "https://kaizenstore.cloud/pricing" });
    expect(route(routes, "www.kaizenstores.com", "/")).toEqual({ redirect: "https://kaizenstore.cloud/" });
    // Another domain ending the same way is not the store domain.
    expect(route(routes, "demo.notkaizenstores.com", "/no")).toEqual({});
  });

  it("works on localhost, where Kaizen and the domain share a host name", () => {
    const routes = storeHostRoutes("localhost:3000", "http://localhost:3000");
    expect(route(routes, "localhost:3000", "/")).toEqual({});
    expect(route(routes, "localhost:3000", "/s/demo/no")).toEqual({ redirect: "http://demo.localhost:3000/no" });
    expect(route(routes, "demo.localhost:3000", "/no")).toEqual({ rewrite: "/s/demo/no" });
  });

  it("serves a store on its primary domain, and leads its other addresses there (P8)", () => {
    const hosts = { kari: { primary: "butikk.example.no", hosts: ["butikk.example.no", "example.no"] }, ola: { primary: null, hosts: ["ola.no"] } };
    const routes = storeHostRoutes("kaizenstore.site", "https://kaizenstore.cloud", hosts);
    expect(route(routes, "butikk.example.no", "/")).toEqual({ rewrite: "/s/kari" });
    expect(route(routes, "butikk.example.no", "/no/p/kopp")).toEqual({ rewrite: "/s/kari/no/p/kopp" });
    expect(route(routes, "butikk.example.no", "/api/consent")).toEqual({});
    expect(route(routes, "butikk.example.no", "/admin")).toEqual({ rewrite: "/s/kari/admin" });
    // Its other domain, its host on the store domain and its old address all lead to the primary.
    expect(route(routes, "example.no", "/no")).toEqual({ redirect: "https://butikk.example.no/no" });
    expect(route(routes, "kari.kaizenstore.site", "/no")).toEqual({ redirect: "https://butikk.example.no/no" });
    expect(route(routes, "kaizenstore.cloud", "/s/kari/no")).toEqual({ redirect: "https://butikk.example.no/no" });
    // Without a primary, the store stays on its host and its domain leads there.
    expect(route(routes, "ola.no", "/no")).toEqual({ redirect: "https://ola.kaizenstore.site/no" });
    expect(route(routes, "ola.kaizenstore.site", "/no")).toEqual({ rewrite: "/s/ola/no" });
    // Other stores as before; an unknown domain is nobody's.
    expect(route(routes, "demo.kaizenstore.site", "/no")).toEqual({ rewrite: "/s/demo/no" });
    expect(route(routes, "notbutikk.example.no", "/no")).toEqual({});

    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv("NEXT_PUBLIC_STORE_HOSTS", JSON.stringify(hosts));
    expect(storeOrigin("kari")).toBe("https://butikk.example.no");
    expect(storeOrigin("ola")).toBe("https://ola.kaizenstore.site");
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "localhost:3000");
    expect(storeOrigin("kari")).toBe("http://butikk.example.no:3000");
    const local = storeHostRoutes("localhost:3000", "http://localhost:3000", hosts);
    expect(route(local, "kari.localhost:3000", "/no")).toEqual({ redirect: "http://butikk.example.no:3000/no" });
  });
});
