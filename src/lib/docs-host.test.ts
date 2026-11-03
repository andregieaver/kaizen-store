import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { matchHas, prepareDestination } from "next/dist/shared/lib/router/utils/prepare-destination";
import { afterEach, describe, expect, it, vi } from "vitest";

import { storeOfHost } from "./ab-routing";
import { docsHost, docsHostRoutes, docsMarkdownPath, docsOrigin, docsPath, docsSiteHref, docsUrl, isDocsHost } from "./docs-host";
import { storeHostRoutes } from "./store-hosts";
import { themeHostRoutes } from "./theme-host";

afterEach(() => vi.unstubAllEnvs());

type Rule = { source: string; destination: string; has?: { type: "host"; value: string }[]; missing?: { type: "host"; value: string }[] };
type Routes = { redirects: Rule[]; rewrites: Rule[] };

/** Where a request ends up, matched as Next.js matches its routes: redirects first, then the rewrites before files, each in turn. */
function route(routes: Routes, host: string, pathname: string): { redirect?: string; rewrite?: string } {
  const req = { headers: { host } } as never;
  const apply = (rule: Rule, from = pathname) => {
    const params = getPathMatch(rule.source, { removeUnnamedParams: true })(from);
    if (!params) return null;
    const hasParams = matchHas(req, {}, rule.has, rule.missing);
    if (!hasParams) return null;
    const { parsedDestination } = prepareDestination({ appendParamsToQuery: false, destination: rule.destination, params: { ...params, ...hasParams }, query: {} });
    const { protocol, hostname, port, pathname: to } = parsedDestination;
    return hostname ? `${protocol}//${hostname}${port ? `:${port}` : ""}${to || "/"}` : to;
  };
  for (const rule of routes.redirects) {
    const to = apply(rule);
    if (to) return { redirect: to };
  }
  let rewritten: string | null = null;
  for (const rule of routes.rewrites) {
    const to = apply(rule, rewritten ?? pathname);
    if (to) rewritten = to;
  }
  return rewritten ? { rewrite: rewritten } : {};
}

/** The rules as `next.config.ts` puts them together: the theme store's, the docs', then the stores'. */
function all(storeDomain: string | null, docs: string | null, themes: string | null = null): Routes {
  const site = "https://kaizenaflow.com";
  const t = themeHostRoutes(themes, site);
  const d = docsHostRoutes(docs, site);
  const s = storeHostRoutes(storeDomain, site, {}, [themes, docs]);
  return { redirects: [...t.redirects, ...d.redirects, ...s.redirects], rewrites: [...t.rewrites, ...d.rewrites, ...s.rewrites] };
}

describe("the docs without a host of their own (D442)", () => {
  it("are at /docs and /no/docs on Kaizena Flow's site, each page's Markdown at its address plus .md", () => {
    expect(docsHost()).toBeNull();
    expect(docsPath()).toBe("/docs");
    expect(docsPath("owners/getting-started/create-your-store")).toBe("/docs/owners/getting-started/create-your-store");
    expect(docsPath("", "nb")).toBe("/no/docs");
    expect(docsPath("owners", "nb")).toBe("/no/docs/owners");
    expect(docsPath("#x")).toBe("/docs#x");
    expect(docsMarkdownPath("owners/a/b")).toBe("/docs/owners/a/b.md");
    expect(docsUrl("developers")).toBe("http://localhost:3000/docs/developers");
    expect(docsSiteHref("/status")).toBe("/status");
    const routes = all(null, null);
    expect(routes.redirects).toEqual([]);
    expect(route(routes, "kaizenaflow.com", "/docs/owners/a/b")).toEqual({});
    expect(route(routes, "kaizenaflow.com", "/docs/owners/a/b.md")).toEqual({ rewrite: "/docs/md/owners/a/b" });
    expect(route(routes, "kaizenaflow.com", "/no/docs/owners/a/b.md")).toEqual({ rewrite: "/docs/md/no/owners/a/b" });
    expect(route(routes, "localhost", "/docs/developers/overview/authentication.md")).toEqual({ rewrite: "/docs/md/developers/overview/authentication" });
    // Nothing else ending in .md is touched.
    expect(route(routes, "kaizenaflow.com", "/blog/x.md")).toEqual({});
    expect(route(routes, "kaizenaflow.com", "/docs.md")).toEqual({});
  });
});

describe("the docs on their own host (D442)", () => {
  it("serve the front page, the tracks, the changelog and the host's own files at its root", () => {
    const routes = all("kaizenstore.site", "docs.kaizenaflow.com");
    const on = (path: string) => route(routes, "docs.kaizenaflow.com", path);
    expect(on("/")).toEqual({ rewrite: "/docs" });
    expect(on("/owners")).toEqual({ rewrite: "/docs/owners" });
    expect(on("/owners/getting-started/create-your-store")).toEqual({ rewrite: "/docs/owners/getting-started/create-your-store" });
    expect(on("/developers/overview/authentication")).toEqual({ rewrite: "/docs/developers/overview/authentication" });
    expect(on("/reference/products")).toEqual({ rewrite: "/docs/reference/products" });
    expect(on("/changelog")).toEqual({ rewrite: "/docs/changelog" });
    for (const file of ["sitemap.xml", "robots.txt", "llms.txt", "llms-full.txt"]) expect(on(`/${file}`)).toEqual({ rewrite: `/docs/${file}` });
    expect(on("/no")).toEqual({ rewrite: "/no/docs" });
    expect(on("/no/owners/getting-started/create-your-store")).toEqual({ rewrite: "/no/docs/owners/getting-started/create-your-store" });
    // The search page (D443), in each language; nothing else under it.
    expect(on("/search")).toEqual({ rewrite: "/docs/search" });
    expect(on("/no/search")).toEqual({ rewrite: "/no/docs/search" });
    expect(on("/searching")).toEqual({ redirect: "https://kaizenaflow.com/searching" });
    expect(on("/no/searches")).toEqual({ redirect: "https://kaizenaflow.com/no/searches" });
  });

  it("answers each page's Markdown at its address plus .md", () => {
    const routes = all("kaizenstore.site", "docs.kaizenaflow.com");
    const on = (path: string) => route(routes, "docs.kaizenaflow.com", path);
    expect(on("/owners/getting-started/create-your-store.md")).toEqual({ rewrite: "/docs/md/owners/getting-started/create-your-store" });
    expect(on("/no/owners/getting-started/create-your-store.md")).toEqual({ rewrite: "/docs/md/no/owners/getting-started/create-your-store" });
    expect(on("/changelog.md")).toEqual({ rewrite: "/docs/md/changelog" });
    // The generated reference's pages (E4), its front page too.
    expect(on("/reference/admin-api/products.md")).toEqual({ rewrite: "/docs/md/reference/admin-api/products" });
    expect(on("/reference.md")).toEqual({ rewrite: "/docs/md/reference" });
  });

  it("sends any other address on the host to Kaizena Flow's, and leaves the API, Next.js's files and public alone", () => {
    const routes = all("kaizenstore.site", "docs.kaizenaflow.com");
    const on = (path: string) => route(routes, "docs.kaizenaflow.com", path);
    expect(on("/pricing")).toEqual({ redirect: "https://kaizenaflow.com/pricing" });
    expect(on("/admin/sign-in")).toEqual({ redirect: "https://kaizenaflow.com/admin/sign-in" });
    expect(on("/no/blog")).toEqual({ redirect: "https://kaizenaflow.com/no/blog" });
    expect(on("/ownersx")).toEqual({ redirect: "https://kaizenaflow.com/ownersx" });
    expect(on("/api/docs/feedback")).toEqual({});
    expect(on("/_next/static/x.js")).toEqual({});
    expect(on("/kaizen/icon.png")).toEqual({});
  });

  it("moves Kaizena Flow's own /docs there for good, and leaves a store's /docs alone", () => {
    const routes = all("kaizenstore.site", "docs.kaizenaflow.com");
    expect(route(routes, "kaizenaflow.com", "/docs")).toEqual({ redirect: "https://docs.kaizenaflow.com/" });
    expect(route(routes, "kaizenaflow.com", "/docs/owners/a/b")).toEqual({ redirect: "https://docs.kaizenaflow.com/owners/a/b" });
    expect(route(routes, "kaizenaflow.com", "/docs/owners/a/b.md")).toEqual({ redirect: "https://docs.kaizenaflow.com/owners/a/b.md" });
    expect(route(routes, "kaizenaflow.com", "/docs/llms.txt")).toEqual({ redirect: "https://docs.kaizenaflow.com/llms.txt" });
    expect(route(routes, "kaizenaflow.com", "/no/docs")).toEqual({ redirect: "https://docs.kaizenaflow.com/no" });
    expect(route(routes, "kaizenaflow.com", "/no/docs/owners/a")).toEqual({ redirect: "https://docs.kaizenaflow.com/no/owners/a" });
    expect(route(routes, "kaizenaflow.com", "/docs/search")).toEqual({ redirect: "https://docs.kaizenaflow.com/search" });
    expect(route(routes, "kaizenaflow.com", "/no/docs/search")).toEqual({ redirect: "https://docs.kaizenaflow.com/no/search" });
    expect(route(routes, "demo.kaizenstore.site", "/docs")).toEqual({ rewrite: "/s/demo/docs" });
    expect(route(routes, "kaizenaflow.com", "/blog")).toEqual({});
    expect(route(routes, "docs.kaizenaflow.com", "/docs")).toEqual({ redirect: "https://kaizenaflow.com/docs" });
  });

  it("is never a store's host, even as a name under the store domain beside the theme store's", () => {
    const routes = all("localhost:3000", "docs.localhost:3000", "themes.localhost:3000");
    expect(route(routes, "docs.localhost", "/")).toEqual({ rewrite: "/docs" });
    expect(route(routes, "docs.localhost", "/owners/a/b")).toEqual({ rewrite: "/docs/owners/a/b" });
    expect(route(routes, "docs.localhost", "/owners/a/b.md")).toEqual({ rewrite: "/docs/md/owners/a/b" });
    expect(route(routes, "themes.localhost", "/")).toEqual({ rewrite: "/themes" });
    expect(route(routes, "demo.localhost", "/no")).toEqual({ rewrite: "/s/demo/no" });
    expect(route(routes, "docsx.localhost", "/")).toEqual({ rewrite: "/s/docsx" });
    expect(route(routes, "docs.localhost", "/sign-up")).toEqual({ redirect: "https://kaizenaflow.com/sign-up" });
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "docs.localhost:3000");
    expect(storeOfHost("docs.localhost:3000", "localhost:3000", {})).toBeNull();
    expect(storeOfHost("demo.localhost:3000", "localhost:3000", {})).toBe("demo");
  });

  it("links within the host from its root, and to Kaizena Flow in full", () => {
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "Docs.KaizenaFlow.com");
    vi.stubEnv("SITE_URL", "https://kaizenaflow.com");
    expect(docsHost()).toBe("docs.kaizenaflow.com");
    expect(docsOrigin()).toBe("https://docs.kaizenaflow.com");
    expect(isDocsHost("docs.kaizenaflow.com")).toBe(true);
    expect(isDocsHost("kaizenaflow.com")).toBe(false);
    expect(docsPath()).toBe("/");
    expect(docsPath("owners")).toBe("/owners");
    expect(docsPath("", "nb")).toBe("/no");
    expect(docsPath("owners/a/b", "nb")).toBe("/no/owners/a/b");
    expect(docsUrl()).toBe("https://docs.kaizenaflow.com/");
    expect(docsUrl("changelog")).toBe("https://docs.kaizenaflow.com/changelog");
    expect(docsMarkdownPath("owners/a/b", "nb")).toBe("/no/owners/a/b.md");
    expect(docsSiteHref("/status")).toBe("https://kaizenaflow.com/status");
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "docs.localhost:3000");
    expect(docsOrigin()).toBe("http://docs.localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_DOCS_HOST", "docs kaizenaflow.com");
    expect(() => docsHost()).toThrow(/NEXT_PUBLIC_DOCS_HOST/);
  });
});
