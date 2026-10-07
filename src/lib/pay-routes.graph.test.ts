import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_ON_PAY_ROUTES, importsForbidden } from "./pay-routes";

/**
 * What a pay route may not reach (wave 1, 1e, `docs/wave-1-trust.md` 2.5, 6.1; `docs/pci.md`): the cart, checkout and order carry a strict
 * Content-Security-Policy and draw nothing another site's code can come in through. The policy is the net; these tests are the other
 * half: the market layout and the pay routes do not import the consent banner, the owner's code, the chat widget, referral capture or
 * the business popup, and the layout's `@extras` slot (which does) is empty on the three routes.
 */
const SRC = join(process.cwd(), "src");
const MARKET = join(SRC, "app/s/[store]/[market]");

const IMPORT =
  /(?:^|\n)\s*(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** Whether an import clause brings in only types, which are erased and carry nothing into the bundle: `import type { A }`, `import { type A }`. */
function typesOnly(clause: string): boolean {
  if (/^type\s/.test(clause.trim())) return true;
  const named = /^\{([\s\S]*)\}$/.exec(clause.trim());
  return (
    named !== null &&
    named[1]
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .every((part) => part.startsWith("type "))
  );
}

/** The modules a file imports as values. */
function importsOf(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(IMPORT)) {
    if (match[3] !== undefined) {
      if (!typesOnly(match[2])) found.push(match[3]);
    } else found.push((match[4] ?? match[5])!);
  }
  return found;
}

function resolve(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? join(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file `entry` reaches by static or dynamic import inside `src/`, the entry included, minus what `stop` says not to follow. */
function reach(entry: string, stop: (file: string) => boolean = () => false): Map<string, string> {
  const seen = new Map<string, string>([[entry, ""]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    const text = readFileSync(file, "utf8");
    for (const specifier of importsOf(text)) {
      const target = resolve(file, specifier);
      if (!target || seen.has(target) || stop(target)) continue;
      seen.set(target, file);
      queue.push(target);
    }
  }
  return seen;
}

/** Every source file of the storefront that links somewhere. */
function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) found.push(path);
  }
  return found;
}

const rel = (file: string) => relative(SRC, file).replaceAll("\\", "/");

/**
 * `lib/custom-code` is also the module that parses what a store keeps (`server/stores.ts` reads it into every store), and
 * `components/buyer` holds the header's business switch beside the popup, so reaching either is not drawing what is forbidden; the
 * drawing is found below by the names of what draws, which are defined in those two files and so are left out there.
 */
const READS_ONLY = new Set(["lib/custom-code", "components/buyer"]);
const DRAWS = /\b(liveCustomCode|StoreCustomCode|ConsentManager|SiteConsent|StoreChat|BuyerQuestion|StoreAffiliate)\b/g;

/** What a file reaches that a pay route may not: a forbidden module, or the use of a name that draws one, with the chain that leads there. */
function forbiddenFrom(entry: string, stop?: (file: string) => boolean): string[] {
  const seen = reach(entry, stop);
  const chainTo = (file: string) => {
    const chain = [rel(file)];
    for (let at = seen.get(file); at; at = seen.get(at)) chain.unshift(rel(at));
    return chain.join(" -> ");
  };
  return [...seen.keys()].flatMap((file) => {
    const name = rel(file).replace(/\.tsx?$/, "");
    const found: string[] = [];
    if (importsForbidden(name) && !READS_ONLY.has(name)) found.push(`reaches ${chainTo(file)}`);
    const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    if (!READS_ONLY.has(name))
      for (const used of new Set([...code.matchAll(DRAWS)].map((m) => m[1]))) found.push(`${rel(file)} uses ${used}`);
    return found;
  });
}

/**
 * A page the owner built holds the shop's own components through `StorePartSection`, which also knows every other working page (My
 * account, the cookie list, ...). Those draw only on their own routes, so the walk stops at that one door; the pieces the pay routes
 * draw (`cart-contents`, `checkout-section`, `order-section`) are walked on their own below.
 */
const stop = (file: string) => rel(file) === "components/store-part-section.tsx";

/** The one file that imports the extras; the layout reaches them only through it, inside `OffPayRoutes`, and is walked with this door shut. */
const EXTRAS = "app/s/[store]/[market]/extras.tsx";
const stopAtExtras = (file: string) => stop(file) || rel(file) === EXTRAS;

describe("the import graph of the market layout", () => {
  it("does not reach the consent banner, the owner's code, the chat, referral capture or the business popup", () => {
    expect(forbiddenFrom(join(MARKET, "layout.tsx"), stopAtExtras)).toEqual([]);
  });

  it("draws the extras only inside OffPayRoutes, which draws nothing on a pay route", () => {
    const layout = readFileSync(join(MARKET, "layout.tsx"), "utf8");
    expect(layout).toMatch(/<OffPayRoutes>\s*<MarketExtras store=\{store\} market=\{market\} \/>\s*<\/OffPayRoutes>/);
    // Nothing else of the layout names what draws them, and no other file of the market imports the extras.
    expect(layout.match(/MarketExtras/g)).toHaveLength(2);
    for (const file of [...sources(MARKET)]) {
      if (rel(file) === EXTRAS || rel(file) === "app/s/[store]/[market]/layout.tsx") continue;
      expect(readFileSync(file, "utf8"), rel(file)).not.toMatch(/from "\.\/extras"|from "\.\.\/extras"|MarketExtras/);
    }
  });

  it("would notice one: the slot's own component reaches all of them", () => {
    const found = forbiddenFrom(join(MARKET, "extras.tsx"), stop).join("\n");
    for (const name of ["StoreChat", "SiteConsent", "StoreAffiliate", "BuyerQuestion", "liveCustomCode"])
      expect(found, name).toContain(name);
  });

  it("holds the extras in one component, which is where they are drawn", () => {
    const extras = reach(join(MARKET, "extras.tsx"));
    const names = [...extras.keys()].map((file) => rel(file).replace(/\.tsx?$/, ""));
    // The slot's component really draws what the layout no longer does, so this test cannot pass by the list going stale.
    for (const fragment of FORBIDDEN_ON_PAY_ROUTES) {
      if (
        fragment === "lib/custom-code" ||
        fragment === "components/affiliate-capture" ||
        fragment === "components/chat-widget" ||
        fragment === "components/consent/consent-manager" ||
        fragment === "components/consent/store-custom-code"
      )
        continue;
      expect(
        names.some((name) => name === fragment),
        fragment,
      ).toBe(true);
    }
  });
});

describe("the import graph of the pay routes", () => {
  const pages = [
    "cart/page.tsx",
    "checkout/page.tsx",
    "order/[orderId]/page.tsx",
    "order/[orderId]/terms/[role]/page.tsx",
    "cart/cart-contents.tsx",
    "checkout/checkout-section.tsx",
    "order/[orderId]/order-section.tsx",
  ];

  it.each(pages)("%s reaches none of them", (page) => {
    expect(forbiddenFrom(join(MARKET, page), stop)).toEqual([]);
  });
});

describe("entering a pay route", () => {
  it("is never a client-side <Link> to the checkout, and no code redirects to it from the browser's router", () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(SRC, "components")), ...sources(MARKET)]) {
      if (rel(file).startsWith("components/admin/")) continue;
      const text = readFileSync(file, "utf8");
      // A <Link> whose href names the checkout; the cart's own `Link` back from the checkout is to the cart and is fine.
      if (/<Link[^>]*href=\{[^}]*\/checkout[`"'/}]/.test(text)) offenders.push(`${rel(file)}: a Link to /checkout`);
      if (/router\.(push|replace)\([^)]*\/checkout/.test(text)) offenders.push(`${rel(file)}: the router goes to /checkout`);
    }
    expect(offenders).toEqual([]);
  });

  it("is, from the cart's button, a full page load", () => {
    const button = readFileSync(join(SRC, "components/checkout-button.tsx"), "utf8");
    expect(button).toMatch(/window\.location\.assign\(to\)/);
    const action = readFileSync(join(MARKET, "cart/actions.ts"), "utf8");
    // The action hands back where to go; it does not redirect through the router.
    expect(action).not.toMatch(/redirect\(result\.url\)/);
    expect(action).toMatch(/to: result\.url/);
  });

  it("is guarded on each of the three pages, and the layout watches where the document has been", () => {
    for (const page of ["cart/page.tsx", "checkout/page.tsx", "order/[orderId]/page.tsx"]) {
      expect(readFileSync(join(MARKET, page), "utf8"), page).toMatch(/<PayRouteGuard store=\{store\.slug\} \/>/);
    }
    expect(readFileSync(join(MARKET, "layout.tsx"), "utf8")).toMatch(/<PayDocumentWatcher \/>/);
  });
});

/**
 * The cart's gift box and a draft order's pay link (wave 3, run 2, D173, `docs/wave-3-orders.md` 5.3): the cart is a pay route, so its client bundle stays free of zod
 * (its JIT probe is reported as a CSP violation, D158) and of every server module; the pay link carries a bearer token in its address, so it draws none of the forbidden extras either.
 * A "use server" file is the boundary: the browser gets a reference to its action, not its imports, so the walk stops at `actions.ts`.
 */
describe("the gift box and the pay link", () => {
  const atActions = (file: string) => /\/actions\.ts$/.test(file);
  const importedBy = (entry: string) => {
    const seen = reach(entry, atActions);
    return [...seen.keys()].flatMap((file) => [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => ({ file: rel(file), specifier: m[1] })));
  };

  it.each(["cart/cart-gift.tsx", "account/pay/[token]/pay-form.tsx"])("%s reaches no zod, no server-only module and no server code", (entry) => {
    const imports = importedBy(join(MARKET, entry));
    const offenders = imports.filter(({ specifier }) => specifier === "zod" || specifier === "server-only" || specifier.startsWith("@/server/") || specifier.startsWith("@/db/"));
    expect(offenders).toEqual([]);
  });

  it("the gift box keeps its checks in the pure gift module, the one the server runs", () => {
    const imports = importedBy(join(MARKET, "cart/cart-gift.tsx")).map((i) => i.specifier);
    expect(imports).toContain("@/lib/gift");
  });

  it("the gift module imports nothing of zod or the server", () => {
    const text = readFileSync(join(SRC, "lib/gift.ts"), "utf8");
    expect(text).not.toMatch(/from\s+["'](zod|server-only)["']/);
  });

  it.each(["account/pay/[token]/page.tsx", "account/pay/[token]/pay-view.tsx", "account/pay/[token]/pay-form.tsx"])("%s reaches none of the forbidden extras", (page) => {
    expect(forbiddenFrom(join(MARKET, page), stop)).toEqual([]);
  });

  it("the pay link's page is guarded like a pay route, is not indexed and is not passed on as a referrer", () => {
    const page = readFileSync(join(MARKET, "account/pay/[token]/page.tsx"), "utf8");
    expect(page).toMatch(/<PayRouteGuard store=\{store\.slug\} \/>/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).toMatch(/referrer: "no-referrer"/);
  });
});

/**
 * A change's pay link and the parcels on the order page (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 6.4 (h)): the change page carries a bearer token in its address like a draft's pay link,
 * so it draws none of the forbidden extras, its button's client bundle reaches no zod and no server code, and it is guarded, never indexed and not passed on as a referrer. The parcels
 * component is drawn on the order page, a pay route: a server component that imports no zod and reaches no forbidden module.
 */
describe("the change pay link and the order's parcels", () => {
  const atActions = (file: string) => /\/actions\.ts$/.test(file);
  const importedBy = (entry: string) => {
    const seen = reach(entry, atActions);
    return [...seen.keys()].flatMap((file) => [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map((m) => ({ file: rel(file), specifier: m[1] })));
  };

  it("the change page's button reaches no zod, no server-only module and no server code", () => {
    const imports = importedBy(join(MARKET, "account/change/[token]/change-form.tsx"));
    const offenders = imports.filter(({ specifier }) => specifier === "zod" || specifier === "server-only" || specifier.startsWith("@/server/") || specifier.startsWith("@/db/"));
    expect(offenders).toEqual([]);
  });

  it.each(["account/change/[token]/page.tsx", "account/change/[token]/change-view.tsx", "account/change/[token]/change-form.tsx"])("%s reaches none of the forbidden extras", (page) => {
    expect(forbiddenFrom(join(MARKET, page), stop)).toEqual([]);
  });

  it("the change page is guarded like a pay route, is not indexed and is not passed on as a referrer", () => {
    const page = readFileSync(join(MARKET, "account/change/[token]/page.tsx"), "utf8");
    expect(page).toMatch(/<PayRouteGuard store=\{store\.slug\} \/>/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).toMatch(/referrer: "no-referrer"/);
  });

  it("the parcels component imports no zod and no server code as values, and reaches none of the forbidden extras", () => {
    const entry = join(SRC, "components/order-shipments.tsx");
    const values = importsOf(readFileSync(entry, "utf8"));
    expect(values.filter((s) => s === "zod" || s === "server-only" || s.startsWith("@/server/") || s.startsWith("@/db/"))).toEqual([]);
    expect(forbiddenFrom(entry, stop)).toEqual([]);
    // And the order page draws it.
    expect(readFileSync(join(MARKET, "order/[orderId]/order-section.tsx"), "utf8")).toMatch(/<OrderShipments /);
  });
});
