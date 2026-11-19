// What a server entry reaches by static value imports (bloat review step 1.8), shared by `scripts/route-load.mjs` (which writes
// src/server/route-load.baseline.json) and `src/server/route-load.graph.test.ts` (which holds the code to it). Built on import-walk.mjs.
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

import { largestCycle, packagesReached, reach, sourceFiles } from "./import-walk.mjs";

/** The entries held: a short name to a repo-relative file. */
export const ENTRIES = {
  proxy: "src/proxy.ts",
  "start-hook": "src/instrumentation.ts",
  health: "src/app/api/health/route.ts",
  "beacon-visit": "src/app/api/visit/route.ts",
  "beacon-touch": "src/app/api/visit/touch/route.ts",
  "beacon-speed": "src/app/api/visit/speed/route.ts",
  "beacon-own-speed": "src/app/api/visit/speed/own/route.ts",
  "beacon-recommendation-events": "src/app/api/recommendations/events/route.ts",
  "shop-tiles": "src/app/api/shop/tiles/route.ts",
  "store-layout": "src/app/s/[store]/[market]/layout.tsx",
  "store-home": "src/app/s/[store]/[market]/(shop)/page.tsx",
  "store-product": "src/app/s/[store]/[market]/(shop)/p/[handle]/page.tsx",
  "admin-store-layout": "src/app/admin/(gated)/[store]/layout.tsx",
  "admin-orders": "src/app/admin/(gated)/[store]/orders/page.tsx",
  "platform-admin-layout": "src/app/admin/(gated)/platform/layout.tsx",
  "platform-admin-home": "src/app/admin/(gated)/platform/page.tsx",
  "site-front-page": "src/app/(platform)/page.tsx",
  "docs-feedback": "src/app/api/docs/feedback/route.ts",
  "page-reads": "src/server/page-reads.ts",
};

/** The five beacons: a visitor's cheapest calls, which carry no admin word and no chat. */
export const BEACONS = ["beacon-visit", "beacon-touch", "beacon-speed", "beacon-own-speed", "beacon-recommendation-events"];

const ADMIN_MESSAGES = "src/lib/admin-messages/";
const BEACON_LIST = [
  "src/server/chat-route.ts",
  "src/server/chat-agent.ts",
  "src/server/auth.ts",
  "src/server/owner-tools.ts",
  "src/server/owner-assistant.ts",
  "src/server/dream-factory.ts",
  "src/lib/admin-text.ts",
  ADMIN_MESSAGES,
  "src/db/schema.ts",
  "stripe",
  "sharp",
  "opentype.js",
  "@supabase/supabase-js",
  "playwright-core",
];
const PROXY_LIST = [
  "src/server/auth.ts",
  "src/server/pages.ts",
  "src/server/seo.ts",
  "src/server/ai.ts",
  "src/lib/admin-text.ts",
  ADMIN_MESSAGES,
  "src/db/schema.ts",
  "src/server/owner-tools.ts",
  "src/server/owner-assistant.ts",
  "src/server/dream-factory.ts",
  "playwright-core",
];
/**
 * The proxy runs before every page and prefetch, and imports six leaf readers (bloat review step 2.20): none of the server's heavy
 * modules, the page model, the schema, an admin catalogue, sharp or Stripe.
 */
const PROXY_LEAF_LIST = [
  ...PROXY_LIST,
  "src/server/catalog.ts",
  "src/server/stores.ts",
  "src/server/stripe.ts",
  "src/server/permissions.ts",
  "src/server/customers.ts",
  "src/lib/page-content.ts",
  "sharp",
  "stripe",
];
/** The most files the proxy may reach by static value imports (bloat review step 2.20; 1,309 when the review began, 321 before the step). */
export const PROXY_FILES_MAX = 120;
const STORE_LIST = [
  "src/server/owner-tools.ts",
  "src/server/owner-assistant.ts",
  "src/server/privacy-erasure.ts",
  "src/server/retention.ts",
  "src/server/theme-store.ts",
  "src/server/dream-factory.ts",
  "src/lib/admin-text.ts",
  "sharp",
  "playwright-core",
];
const ADMIN_LIST = ["src/server/owner-assistant.ts", "src/server/owner-tools.ts", "src/lib/owner-tools.ts"];
const SITE_LIST = ["src/server/owner-tools.ts", "src/server/owner-assistant.ts", "src/server/dream-factory.ts"];

/**
 * Per entry, what it may not reach by static value imports: a repo-relative file, a folder (a name ending in `/`, any file under it) or
 * a package name. A rule that fails today is on the baseline's exceptions; the steps of phases 0 and 2 empty it.
 */
export const FORBIDDEN = {
  proxy: PROXY_LEAF_LIST,
  "start-hook": PROXY_LIST,
  health: [...BEACON_LIST, "src/server/stores.ts"],
  ...Object.fromEntries(BEACONS.map((name) => [name, BEACON_LIST])),
  "shop-tiles": BEACON_LIST,
  "store-layout": STORE_LIST,
  "store-home": STORE_LIST,
  "store-product": STORE_LIST,
  "admin-store-layout": ADMIN_LIST,
  "admin-orders": ADMIN_LIST,
  "platform-admin-layout": ADMIN_LIST,
  "platform-admin-home": ADMIN_LIST,
  "site-front-page": SITE_LIST,
  "docs-feedback": SITE_LIST,
  "page-reads": ["src/server/pages.ts", "src/server/auth.ts", "src/server/design-presets.ts", "src/server/page-ai.ts", "src/lib/signature/"],
};

/** A route.ts whose function loads more files than this is named, with its reason, in the baseline. */
export const HEAVY = 1500;

const WALK = { dynamic: false, clientLeaf: true };
const posix = (root, file) => path.relative(root, file).split(path.sep).join("/");

function routeFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) routeFiles(file, found);
    else if (name === "route.ts") found.push(file);
  }
  return found;
}

/** The forbidden items of `list` that the walk `seen` (and its packages) reaches, sorted. */
function reachedItems(root, seen, packages, list) {
  const files = [...seen.keys()].map((file) => posix(root, file));
  return list
    .filter((item) =>
      item.endsWith("/") ? files.some((file) => file.startsWith(item)) : item.startsWith("src/") ? files.includes(item) : packages.has(item),
    )
    .sort();
}

/**
 * The counts held: `largestCycle` (the size among the source files of src/server), `entries` (files reached per entry), `exceptions`
 * (the forbidden items each entry reaches today) and `handlers` (files reached by every route.ts over HEAVY).
 */
export function routeLoadCounts(root) {
  const src = path.join(root, "src");
  const memo = new Map();
  const cycle = largestCycle(src, sourceFiles(path.join(src, "server")), { dynamic: false });
  const entries = {};
  const exceptions = {};
  for (const [name, file] of Object.entries(ENTRIES)) {
    const entry = path.join(root, file);
    const seen = reach(src, entry, { ...WALK, memo });
    entries[name] = seen.size;
    exceptions[name] = reachedItems(root, seen, packagesReached(src, entry, WALK), FORBIDDEN[name]);
  }
  const handlers = {};
  for (const file of routeFiles(path.join(src, "app"))) {
    const size = reach(src, file, { ...WALK, memo }).size;
    if (size > HEAVY) handlers[posix(root, file)] = size;
  }
  return { largestCycle: cycle.size, entries, exceptions, handlers };
}

/** The chain of imports from the walk's entry to `file`, as repo-relative paths joined by arrows. */
export function chainTo(root, seen, file) {
  const chain = [posix(root, file)];
  for (let at = seen.get(file); at; at = seen.get(at)) chain.unshift(posix(root, at));
  return chain.join(" -> ");
}

/** The walk the graph test reads chains from. */
export function walkOf(root, name) {
  return reach(path.join(root, "src"), path.join(root, ENTRIES[name]), WALK);
}
