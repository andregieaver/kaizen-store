import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import baseline from "./storefront-bundle.baseline.json";

/**
 * What the visitor's browser loads (D211, `docs/performance.md`): every client component a visitor's page can draw is walked through
 * its static imports, and none may reach zod, the page model (`lib/page-content`) or the interface text of every language (D212). zod
 * with its translations is 90 KB of the first scripts, and a schema built in the browser checks nothing the server does not check
 * again. A module that has both plain helpers and schemas keeps its schemas in `*-schema.ts` beside it.
 *
 * The walk with `later` also follows `import()` (a view loaded when it is needed), and what it newly reaches is held in the baseline.
 * The lists live in `storefront-bundle.baseline.json` beside this file (bloat review step 1.27); rewrite it with
 * `WRITE_STOREFRONT_BASELINE=1 pnpm exec vitest run src/lib/storefront-bundle.scan.test.ts`. Its keys:
 *   - `pages`: per page (the market layout, a built page, the product page, a listing, the cart) the client modules its server code
 *     imports, each with its reason; the lists only shrink, and a new one needs a lazy stand-in in `components/lazy` or a reason.
 *   - `laterChains`: the `entry => target` pairs that a view loaded with `import()` newly reaches among the forbidden files.
 *   - `adminWords`: the visitor components allowed to reach the admin's words (the sign-up wizard), each with its reason.
 *   - `cookiePurposes`: the client roots of the pages allowed to reach the cookies' purposes (`lib/known-cookies`); only shrinks.
 *   - `browserTextBytes`: the bytes of the four `messages/*-browser.ts` files together; it only falls.
 *
 * Left out: the admin, and the staff's text editing on the live site (`components/inline-edit`), which is loaded only when a
 * signed-in person turns it on. A server action file (`"use server"`) is a reference in the browser, not its code.
 */
const WRITE = process.env.WRITE_STOREFRONT_BASELINE === "1";
const planted = new Map<string, string>();
function read(file: string): string {
  return (planted.get(file) ?? "") + readFileSync(file, "utf8");
}
function withPlanted<T>(file: string, extraImportLine: string, run: () => T): T {
  planted.set(file, extraImportLine + "\n");
  try {
    return run();
  } finally {
    planted.delete(file);
  }
}
const SRC = join(process.cwd(), "src");
const FORBIDDEN = ["zod", "lib/page-content", "lib/i18n", "lib/email-text", "lib/store-features", "lib/known-cookies", "lib/background-layers"];

/**
 * The one chain allowed to reach a forbidden file, as data: the admin's words (`lib/admin-messages/*`) reach a visitor's script only
 * through the sign-up wizard's `components/admin/admin-text-context` (`docs/performance.md`, the sign-up wizard). Nothing else is
 * excused: `lib/known-cookies` has no exception, as `cookie-policy.tsx` is a server component (no "use client" line), so no walk
 * from a client entry reaches it.
 */
const ALLOWED = [{ target: /^lib\/admin-messages\//, through: "components/admin/admin-text-context" }];

/**
 * The interface text (D212): every text of every language is 270 KB, which a visitor's browser never loads. Its client components
 * read `browserText()` (`messages/*-browser.ts`) and the withdrawal function `returnsText()` (`messages/*-returns.ts`); a language's
 * whole module (`messages/nb.ts`) is the server's and the admin's.
 */
function forbidden(target: string): boolean {
  const name = rel(target);
  return FORBIDDEN.includes(name) || /^lib\/messages\/[a-z]{2}$/.test(name) || /^lib\/admin-messages\//.test(name);
}

const DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Whether an import brings in only types, which are erased: `import type { A }`, `import { type A }`. */
function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return named !== null && named[1].split(",").map((part) => part.trim()).filter(Boolean).every((part) => part.startsWith("type "));
}

function resolve(from: string, specifier: string): string | null {
  if (specifier === "zod" || specifier.startsWith("zod/")) return "zod";
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? join(dirname(from), specifier) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const rel = (file: string) => (file === "zod" ? "zod" : relative(SRC, file).replaceAll("\\", "/").replace(/\.tsx?$/, ""));
const directive = (text: string, name: string) => new RegExp(`^\\s*["']${name}["']`, "m").test(text.slice(0, 300));

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

/** The visitor's client components: every `"use client"` file but the admin's and the staff's editing. */
const ENTRIES = files(SRC).filter((file) => {
  const name = rel(file);
  if (name.startsWith("components/admin/") || name.startsWith("app/admin/") || name.startsWith("components/inline-edit/")) return false;
  return directive(read(file), "use client");
});

/** What `entry` reaches by static import, each with the file that brought it in. */
function reach(entry: string, later = false): Map<string, string> {
  const seen = new Map<string, string>([[entry, ""]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (file === "zod") continue;
    const text = read(file);
    if (file !== entry && directive(text, "use server")) continue;
    const specifiers: string[] = [];
    for (const match of text.matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      specifiers.push(match[2] ?? match[3]);
    }
    if (later) for (const match of text.matchAll(DYNAMIC)) specifiers.push(match[1]);
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (!target || seen.has(target)) continue;
      if (later && /^(components\/admin\/|components\/inline-edit\/)/.test(rel(target))) continue;
      seen.set(target, file);
      queue.push(target);
    }
  }
  return seen;
}

const MARKET = existsSync(join(SRC, "app/s/[store]/[market]/(shop)")) ? join(SRC, "app/s/[store]/[market]/(shop)") : join(SRC, "app/s/[store]/[market]");
const PAGES = {
  layout: join(SRC, "app/s/[store]/[market]/layout.tsx"),
  built: join(MARKET, "[slug]/page.tsx"),
  product: join(MARKET, "p/[handle]/page.tsx"),
  listing: join(MARKET, "category/[slug]/page.tsx"),
  cart: join(MARKET, "cart/page.tsx"),
} as const;
type PageKey = keyof typeof PAGES;
const PAGE_KEYS = Object.keys(PAGES) as PageKey[];
const noShop = (name: string) => name.replace("/(shop)/", "/");

/** The client modules the server code of `entry` imports: static imports walked through files without a directive. */
function clientRoots(entry: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const text = read(file);
    for (const match of text.matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      const target = resolve(file, match[2] ?? match[3]);
      if (!target || target === "zod" || seen.has(target)) continue;
      seen.add(target);
      const targetText = read(target);
      if (directive(targetText, "use client")) found.add(noShop(rel(target)));
      else if (directive(targetText, "use server")) continue;
      else queue.push(target);
    }
  }
  return [...found].sort();
}

/** The first file of a chain that reaches the admin's words, per entry. */
function adminChains(entries: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of entries) {
    const seen = reach(entry);
    for (const target of seen.keys()) {
      const name = rel(target);
      if (!/^lib\/admin-messages\//.test(name) && name !== "lib/admin-text") continue;
      const chain = [name];
      for (let at = seen.get(target); at; at = seen.get(at)) chain.unshift(rel(at));
      found.set(rel(entry), chain.join(" -> "));
      break;
    }
  }
  return found;
}

const PURPOSES = "lib/known-cookies";
const BROWSER_FILES = ["nb", "sv", "da", "en"].map((lang) => join(SRC, `lib/messages/${lang}-browser.ts`));
const browserBytes = () => BROWSER_FILES.reduce((sum, file) => sum + statSync(file).size, 0);

function laterPairs(): string[] {
  const pairs: string[] = [];
  for (const entry of ENTRIES) {
    const statics = reach(entry);
    for (const target of reach(entry, true).keys()) {
      if (forbidden(target) && !statics.has(target)) pairs.push(`${rel(entry)} => ${rel(target)}`);
    }
  }
  return pairs.sort();
}

function cookieRoots(): string[] {
  const found = new Set<string>();
  for (const key of PAGE_KEYS) {
    for (const name of clientRoots(PAGES[key])) {
      const file = [join(SRC, `${name}.tsx`), join(SRC, `${name}.ts`)].find((candidate) => existsSync(candidate)) ?? join(SRC, `${name}.tsx`);
      if (existsSync(file) && reach(file).has(join(SRC, `${PURPOSES}.ts`))) found.add(name);
    }
  }
  return [...found].sort();
}

const BASELINE_FILE = join(SRC, "lib/storefront-bundle.baseline.json");

describe.runIf(WRITE)("the baseline writer", () => {
  it("writes the baseline", () => {
    const pages: Record<string, Record<string, string>> = {};
    for (const key of PAGE_KEYS) {
      const old = (baseline.pages as Record<string, Record<string, string>>)[key] ?? {};
      pages[key] = Object.fromEntries(clientRoots(PAGES[key]).map((name) => [name, old[name] ?? ""]));
    }
    const next = {
      pages,
      laterChains: laterPairs(),
      adminWords: baseline.adminWords,
      cookiePurposes: cookieRoots(),
      browserTextBytes: Math.min(baseline.browserTextBytes, browserBytes()),
    };
    writeFileSync(BASELINE_FILE, JSON.stringify(next, null, 2) + "\n");
  });
});

describe.skipIf(WRITE)("the visitor's scripts", () => {
  it("finds the client components to walk", () => {
    const names = ENTRIES.map(rel);
    for (const name of ["components/carousel", "components/consent/consent-manager", "components/site-form", "components/gallery-lightbox"]) expect(names).toContain(name);
    expect(names.some((name) => name.startsWith("components/admin/"))).toBe(false);
  });

  it("never reach zod, the page model or every language's interface text", () => {
    const found: string[] = [];
    for (const entry of ENTRIES) {
      const seen = reach(entry);
      for (const target of seen.keys()) {
        if (!forbidden(target)) continue;
        const chain = [rel(target)];
        for (let at = seen.get(target); at; at = seen.get(at)) chain.unshift(rel(at));
        if (ALLOWED.some((allowed) => allowed.target.test(rel(target)) && chain.includes(allowed.through))) continue;
        found.push(chain.join(" -> "));
      }
    }
    expect(found).toEqual([]);
  });

  it("would notice: the whole of a language reaches the server's text, its browser texts do not", () => {
    expect([...reach(join(SRC, "lib/i18n.ts")).keys()].some(forbidden)).toBe(true);
    expect([...reach(join(SRC, "lib/browser-text.ts")).keys()].some(forbidden)).toBe(false);
    expect([...reach(join(SRC, "lib/returns-text.ts")).keys()].some(forbidden)).toBe(false);
  });

  it("would notice: the features table, the admin's words and the cookie details stay out of small files", () => {
    const b2b = [...reach(join(SRC, "lib/b2b.ts")).keys()].map(rel);
    expect(b2b).not.toContain("lib/store-features");
    expect(b2b.some((name) => name.startsWith("lib/admin-messages/"))).toBe(false);
    expect([...reach(join(SRC, "lib/cookie-consent.ts")).keys()].map(rel)).not.toContain("lib/known-cookies");
  });

  it("the product page's parts reach no cart form", () => {
    const reached = [...reach(join(SRC, "components/product-parts.tsx")).keys()].map(rel);
    for (const form of ["app/s/[store]/[market]/(shop)/cart/cart-contents", "components/checkout-button", "app/s/[store]/[market]/(shop)/cart/cart-gift"]) {
      expect(reached, form).not.toContain(form);
    }
  });

  it("would notice: the product editor (admin) reaches zod", () => {
    const form = join(SRC, "components/admin/product-editor.tsx");
    expect([...reach(form).keys()].map(rel)).toContain("zod");
  });

  it("scripts loaded later reach zod, the page model or a whole language only where the baseline says, and that list only shrinks", () => {
    const pairs = laterPairs();
    const known = new Set(baseline.laterChains);
    const added = pairs.filter((pair) => !known.has(pair));
    expect(added, "a view loaded with import() must take its words as a prop and read no schema: see docs/performance.md").toEqual([]);
    const gone = baseline.laterChains.filter((pair) => !pairs.includes(pair));
    expect(gone, "remove the line from src/lib/storefront-bundle.baseline.json").toEqual([]);
  });

  it.each(PAGE_KEYS)("a store page's server code imports only the client modules its list names: %s", (key) => {
    const names = clientRoots(PAGES[key]);
    const listed = Object.keys((baseline.pages as Record<string, Record<string, string>>)[key]).map(noShop).sort();
    const added = names.filter((name) => !listed.includes(name));
    expect(
      added,
      `${added[0]} is a new client module in the ${key} page's first scripts. Load it through a stand-in in src/components/lazy (see lazy/blocks.tsx), or add it to src/lib/storefront-bundle.baseline.json with its reason.`,
    ).toEqual([]);
    const gone = listed.filter((name) => !names.includes(name));
    expect(gone, `remove ${gone[0]} from the baseline: the list only shrinks.`).toEqual([]);
    for (const [name, reason] of Object.entries((baseline.pages as Record<string, Record<string, string>>)[key])) expect(reason, `every entry needs a reason: ${name}`).not.toBe("");
  });

  it("no visitor's component reaches the admin's words", () => {
    const found = adminChains(ENTRIES);
    const allowed = Object.keys(baseline.adminWords);
    expect([...found].filter(([entry]) => !allowed.includes(entry)).map(([, chain]) => chain)).toEqual([]);
  });

  it("the store pages' first scripts never hold the cookie purposes", () => {
    expect(readFileSync(join(SRC, `${PURPOSES}.ts`), "utf8")).toContain("purpose:");
    const found = cookieRoots();
    expect(found.filter((name) => !(baseline.cookiePurposes as string[]).includes(name))).toEqual([]);
    expect((baseline.cookiePurposes as string[]).filter((name) => !found.includes(name)), "remove the line from the baseline: the list only shrinks").toEqual([]);
  });

  it("the browser's interface text does not grow", () => {
    const now = browserBytes();
    expect(
      now,
      "these files are in visitors' scripts in every language: move a text here only if a visitor's client component reads it (D212).",
    ).toBeLessThanOrEqual(baseline.browserTextBytes);
    expect(baseline.browserTextBytes, `the browser files shrank: set browserTextBytes in src/lib/storefront-bundle.baseline.json to ${now}.`).toBe(now);
  });

  it("would notice: a cart form, the carousel and the admin's words planted in memory", () => {
    const cart = `@/${rel(MARKET)}/cart/cart-contents`;
    const product = withPlanted(join(SRC, "components/product-parts.tsx"), `import "${cart}";`, () => clientRoots(PAGES.product));
    const listed = Object.keys(baseline.pages.product);
    expect(product.filter((name) => !listed.includes(name))).not.toEqual([]);

    const carousel = withPlanted(join(SRC, "components/content-grid.tsx"), 'import "./carousel";', () => clientRoots(PAGES.built));
    expect(carousel).toContain("components/carousel");

    const admin = withPlanted(join(SRC, "components/buyer.tsx"), 'import "@/lib/admin-messages/common.en";', () => adminChains([join(SRC, "components/buyer.tsx")]));
    expect([...admin.values()].join("\n")).toMatch(/lib\/admin-messages\/common\.en$/m);
  });
});
