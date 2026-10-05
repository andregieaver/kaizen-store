import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LEGACY_MATCHER } from "@/lib/legacy-path";


/**
 * Who may touch what (wave 2, second run, D168, `docs/wave-2-redirects.md` 4.3, 5.2, 6.2): a scan of the source, as the other `*.scan.test.ts` files are. The redirects
 * table is written by `src/server/redirects.ts` and the database's triggers only; the 404 report's tables by `src/server/not-found.ts` only (through the one SQL
 * function); no redirect or report module fetches an address, sets a cookie or reads storage; the store routes ask `missOrRedirect()` where they would give a 404; the
 * proxy imports only what it is allowed to; its matcher is the literal of `LEGACY_MATCHER`; and the lookup's cache life is the one the spike found works.
 */

const root = process.cwd();
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
  }
};
walk(join(root, "src"));
const read = (path: string) => readFileSync(path.startsWith("/") ? path : join(root, path), "utf8");
const rel = (path: string) => path.slice(root.length + 1);
/** The code of a file: its comments (which say what is never done) taken out. */
const code = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The statements that change a table, by the table's name (a `commerce.` prefix and any spacing). */
const writes = (table: string) => new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+commerce\\.${table}\\b`, "i");

describe("the tables of redirects and of the 404 report", () => {
  it("are written only by the redirect service (commerce.redirects) and the 404 report's module (the report's tables)", () => {
    const offenders = (table: string, allowed: string[]) =>
      files.filter((f) => writes(table).test(read(f)) && !allowed.includes(rel(f)));
    expect(offenders("redirects", ["src/server/redirects.ts"])).toEqual([]);
    expect(offenders("not_found_hits", ["src/server/not-found.ts"])).toEqual([]);
    expect(offenders("not_found_ignored", ["src/server/not-found.ts"])).toEqual([]);
  });

  it("call `commerce.record_not_found()` from the report's module only", () => {
    const callers = files.filter((f) => /record_not_found\s*\(/.test(code(f)));
    expect(callers.map(rel)).toEqual(["src/server/not-found.ts"]);
  });
});

describe("the redirect and report modules", () => {
  const mine = files.filter((f) => /src\/(?:server|lib)\/(?:redirect[a-z-]*|not-found|legacy-path|term-seo)\.ts$/.test(f) && !/redirect-test-support/.test(f));

  it("are found by the scan", () => {
    expect(mine.map(rel)).toEqual(
      expect.arrayContaining([
        "src/lib/legacy-path.ts",
        "src/lib/not-found.ts",
        "src/lib/redirect-csv.ts",
        "src/lib/redirect-path.ts",
        "src/lib/redirect-plan.ts",
        "src/lib/redirects.ts",
        "src/lib/term-seo.ts",
        "src/server/not-found.ts",
        "src/server/redirect-export.ts",
        "src/server/redirect-import.ts",
        "src/server/redirect-live.ts",
        "src/server/redirect-resolve.ts",
        "src/server/redirects.ts",
      ]),
    );
  });

  it("never fetch an address, set a cookie or use browser storage", () => {
    for (const file of mine) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/\bfetch\s*\(|safeFetch|\bcookies\s*\(|Set-Cookie|\.cookies\.set|localStorage|sessionStorage/);
    }
  });

  it("never read a person's details of a request: no IP address, user agent or referrer", () => {
    for (const file of mine) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/x-forwarded-for|x-real-ip|\buser-agent\b|\bReferer\b|\breferrer\b|\.ip\b/i);
    }
  });
});

describe("the store's routes", () => {
  it("ask `missOrRedirect()` where they would give a 404 for a missing page, product, category, tag or article", () => {
    for (const route of [
      "src/app/s/[store]/[market]/[slug]/store-page-view.tsx",
      "src/app/s/[store]/[market]/p/[handle]/page.tsx",
      "src/app/s/[store]/[market]/term-listing.tsx",
      "src/app/s/[store]/[market]/blog/[slug]/page.tsx",
      "src/app/s/[store]/[market]/[...rest]/page.tsx",
    ]) {
      const text = read(route);
      expect(text, route).toContain("missOrRedirect(");
      expect(text, route).toContain("@/server/redirect-resolve");
    }
  });

  it("are not reached by a pay route: the lookup is imported by none of /cart, /checkout and /order", () => {
    for (const dir of ["cart", "checkout", "order"]) {
      const base = join(root, "src/app/s/[store]/[market]", dir);
      const inDir: string[] = [];
      const collect = (d: string) => {
        for (const name of readdirSync(d)) {
          const full = join(d, name);
          if (statSync(full).isDirectory()) collect(full);
          else if (/\.tsx?$/.test(name)) inDir.push(full);
        }
      };
      collect(base);
      for (const file of inDir) expect(read(file), rel(file)).not.toMatch(/redirect-resolve|server\/redirects|server\/not-found/);
    }
  });
});

describe("the proxy", () => {
  const source = read("src/proxy.ts");

  it("imports only what it is allowed to", () => {
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(
      ["@/lib/ab-routing", "@/lib/ab-site", "@/lib/experiments", "@/lib/paths", "@/server/experiments", "@/server/not-found", "@/server/redirect-resolve", "next/server"].sort(),
    );
  });

  it("has the legacy matcher written out as the literal of `LEGACY_MATCHER` (a matcher cannot use a constant)", () => {
    expect(source).toContain(JSON.stringify(LEGACY_MATCHER.source));
    expect(source).toContain('key: "kaizen_ab"');
  });

  it("answers an address with no country with a 308 and counts the rest after the response", () => {
    expect(source).toContain("NextResponse.redirect(");
    expect(source).toContain(", 308)");
    expect(source).toContain("event.waitUntil(");
  });
});

describe("the lookup of a missing address", () => {
  it("is a cached function whose life is the one the spike found works: a `stale` of at least 30 seconds and an `expire` of at least 300", () => {
    const text = read("src/server/redirect-resolve.ts");
    const life = /LOOKUP_LIFE\s*=\s*\{\s*stale:\s*(\d+),\s*revalidate:\s*(\d+),\s*expire:\s*(\d+)\s*\}/.exec(text);
    const call = /cacheLife\(\{\s*stale:\s*(\d+),\s*revalidate:\s*(\d+),\s*expire:\s*(\d+)\s*\}\)/.exec(text);
    expect(life).not.toBeNull();
    expect(Number(life![1])).toBeGreaterThanOrEqual(30);
    expect(Number(life![3])).toBeGreaterThanOrEqual(300);
    // The call's argument is read by the compiler, so it is written out: the constant and the call must agree.
    expect(call && [call[1], call[2], call[3]]).toEqual([life![1], life![2], life![3]]);
    // Tagged for every writer to refresh, and never made dynamic (a dynamic miss streams with the status 200).
    expect(text).toContain("cacheTag(redirectsTag(storeId)");
    expect(text).not.toMatch(/\bconnection\s*\(/);
  });

  it("is refreshed by every writer of a redirect through `refreshRedirects()`", () => {
    for (const file of ["src/server/redirects.ts", "src/server/redirect-import.ts"]) expect(read(file), file).toContain("refreshRedirects(");
  });
});
