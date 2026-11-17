import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";

import { buildTestDatabaseTemplate, createTestDatabase } from "@/db/testing";
import { MANAGER_TOOLS } from "@/lib/manager-tools";
import { toolOffered } from "@/lib/owner-tool-features";
import { OWNER_TOOLS } from "@/lib/owner-tools";
import { PLAN_ITEMS, SETTINGS_ITEMS, SUPPORT_ITEMS, WEBSITE_ITEMS } from "@/lib/platform-nav";
import { FEATURE_IDS } from "@/lib/store-features";
import { advancedIn, STORE_SECTIONS } from "@/lib/store-nav";

/**
 * What the surface budget counts (bloat review step 1.18, FT-2 and DS-12): fourteen counts of what every store carries whether it uses
 * it or not, and the indexes and triggers of the eight hot tables. Test support: `src/lib/surface-budget.scan.test.ts` holds them against
 * `src/lib/surface-budget.baseline.json`, and `scripts/surface-budget.mjs` writes that file through it. A new store's rows are counted in
 * `src/db/commerce.test.ts`, not here.
 */

/** The tables a checkout, a visit or the catalogue writes to all day (a copy of `HOT_TABLES` in `src/db/migration-safety.scan.test.ts`, which a test of the scan checks). */
export const SURFACE_HOT_TABLES = ["orders", "order_lines", "visits", "products", "product_variants", "customers", "carts", "cart_lines"];

export type HotCounts = Record<string, { indexes: number; triggers: number }>;

export type SurfaceCounts = {
  dispatcherJobs: number;
  minuteRoutes: number;
  pages: number;
  routeHandlers: number;
  storeLinks: number;
  storeLinksBySection: Record<string, number>;
  basicLinks: number;
  platformLinks: number;
  storeTools: number;
  shopOnlyTools: number;
  managerTools: number;
  featureIds: number;
  tables: number;
  platformTables: number;
  hot: HotCounts;
};

function filesUnder(root: string, dir: string, accept: (name: string) => boolean, found: string[] = []): string[] {
  for (const name of readdirSync(path.join(root, dir)).sort()) {
    const rel = path.posix.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) filesUnder(root, rel, accept, found);
    else if (accept(name)) found.push(rel);
  }
  return found;
}

/** A fresh migrated database for a test outside src/db (that project builds no template of its own, so this keeps one and copies it). */
export async function scratchDatabase(): Promise<PGlite> {
  await buildTestDatabaseTemplate();
  return createTestDatabase();
}

/** The dispatcher's jobs: the keys of `DISPATCHER_JOBS` (two spaces in) plus the `tracked("dispatcher.…")` calls that stay in the route. */
export function dispatcherJobCount(root: string): number {
  const lines = readFileSync(path.join(root, "src/server/dispatcher-jobs.ts"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("export const DISPATCHER_JOBS = {"));
  if (start < 0) throw new Error("src/server/dispatcher-jobs.ts has no line starting 'export const DISPATCHER_JOBS = {' (bloat review step 1.10 made it)");
  let keys = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("}")) break;
    if (/^ {2}(\w+|"[^"]+"): (\(|async \()/.test(line)) keys++;
  }
  const route = readFileSync(path.join(root, "src/app/api/cron/cart-reminders/route.ts"), "utf8");
  return keys + (route.match(/tracked\("dispatcher\.[^"]+"/g) ?? []).length;
}

/** The scheduler's routes that run every minute (`trackedRoute("name", 60, …)`). */
export function minuteRouteCount(root: string): number {
  return filesUnder(root, "src/app/api/cron", (n) => n === "route.ts").filter((f) => /trackedRoute\("[^"]+",\s*60,/.test(readFileSync(path.join(root, f), "utf8"))).length;
}

/** Tables of the commerce schema, those a custom migration makes included (a base table, never a view). */
export async function tableCount(db: PGlite, like?: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "select count(*)::int as n from information_schema.tables where table_schema = 'commerce' and table_type = 'BASE TABLE'" + (like ? " and table_name like $1" : ""),
    like ? [like] : [],
  );
  return rows.rows[0].n;
}

/** Each hot table's indexes and its triggers (the ones a person wrote, not the constraint triggers inside Postgres). */
export async function hotCounts(db: PGlite): Promise<HotCounts> {
  const hot: HotCounts = {};
  for (const name of SURFACE_HOT_TABLES) {
    const indexes = await db.query<{ n: number }>("select count(*)::int as n from pg_indexes where schemaname = 'commerce' and tablename = $1", [name]);
    const triggers = await db.query<{ n: number }>(
      "select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = $1 and not t.tgisinternal",
      [name],
    );
    hot[name] = { indexes: indexes.rows[0].n, triggers: triggers.rows[0].n };
  }
  return hot;
}

/** The fourteen counts and the hot tables' two numbers each, from the code as it stands and one database made by `createTestDatabase()`. */
export async function surfaceCounts(root: string): Promise<SurfaceCounts> {
  const items = STORE_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items));
  const storeLinksBySection = Object.fromEntries(STORE_SECTIONS.map((s) => [s.key, s.groups.flatMap((g) => g.items).length]));
  const basicLinks = STORE_SECTIONS.reduce((n, s) => n + s.groups.flatMap((g) => g.items).filter((i) => !advancedIn(s, i)).length, 0);
  const shopOnly = { features: ["shop"] };
  const db = await scratchDatabase();
  try {
    return {
      dispatcherJobs: dispatcherJobCount(root),
      minuteRoutes: minuteRouteCount(root),
      pages: filesUnder(root, "src/app", (n) => n === "page.tsx").length,
      routeHandlers: filesUnder(root, "src/app", (n) => n === "route.ts" || n === "route.tsx").length,
      storeLinks: items.length,
      storeLinksBySection,
      basicLinks,
      platformLinks: WEBSITE_ITEMS.length + PLAN_ITEMS.length + SUPPORT_ITEMS.length + SETTINGS_ITEMS.length,
      storeTools: OWNER_TOOLS.length,
      shopOnlyTools: OWNER_TOOLS.filter((t) => toolOffered(shopOnly, t.name)).length,
      managerTools: MANAGER_TOOLS.length,
      featureIds: FEATURE_IDS.length,
      tables: await tableCount(db),
      platformTables: await tableCount(db, "platform\\_%"),
      hot: await hotCounts(db),
    };
  } finally {
    await db.close();
  }
}

/**
 * Counts that grow in everyday work (a page, a route handler) have room: a rise inside it is a note, never a failure, and only a large one
 * fails (the owner's decision names tables, triggers, jobs, links and tools). `node scripts/surface-budget.mjs` writes today's figure.
 */
export const NOTE_ROOM: Record<string, number> = { pages: 40, routeHandlers: 15 };

type Numbers = Record<string, number>;
type Budget = Omit<SurfaceCounts, "storeLinksBySection" | "hot"> & { storeLinksBySection: Numbers; hot: HotCounts };

/** Every number of the surface as a flat list: label, current value. */
function flat(c: Pick<Budget, "storeLinksBySection" | "hot"> & Record<string, unknown>): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const [key, value] of Object.entries(c)) {
    if (typeof value === "number") out.push([key, value]);
  }
  for (const [section, n] of Object.entries(c.storeLinksBySection)) out.push([`storeLinksBySection.${section}`, n]);
  for (const [table, h] of Object.entries(c.hot)) {
    out.push([`hot.${table}.indexes`, h.indexes], [`hot.${table}.triggers`, h.triggers]);
  }
  return out;
}

/** Each number above its baseline, as a sentence that says the fix. */
export function surfaceProblems(now: SurfaceCounts, baseline: Pick<Budget, "storeLinksBySection" | "hot"> & Record<string, unknown>): string[] {
  const held = new Map(flat(baseline));
  return flat(now as unknown as Budget)
    .filter(([key, value]) => value > (held.get(key) ?? Number.POSITIVE_INFINITY) + (NOTE_ROOM[key] ?? 0))
    .map(
      ([key, value]) =>
        `${key}: ${value}, budget ${held.get(key)}. A new job, page, table, link, tool, index or trigger adds cost to every store: write its decision with an Idle cost: line, then run node scripts/surface-budget.mjs --raise D<number>.`,
    );
}

/** Rises that stay inside a count's room (`NOTE_ROOM`): printed, not failed. */
export function surfaceNotes(now: SurfaceCounts, baseline: Pick<Budget, "storeLinksBySection" | "hot"> & Record<string, unknown>): string[] {
  const held = new Map(flat(baseline));
  return flat(now as unknown as Budget)
    .filter(([key, value]) => key in NOTE_ROOM && value > (held.get(key) ?? Number.POSITIVE_INFINITY) && value <= (held.get(key) ?? 0) + NOTE_ROOM[key])
    .map(([key, value]) => `${key} rose to ${value}, budget ${held.get(key)} (room ${NOTE_ROOM[key]}): run node scripts/surface-budget.mjs to write today's figure`);
}

/** Each number below its baseline (a section or a hot table the baseline does not know is not a fall). */
export function surfaceFallen(now: SurfaceCounts, baseline: Pick<Budget, "storeLinksBySection" | "hot"> & Record<string, unknown>): string[] {
  const held = new Map(flat(baseline));
  return flat(now as unknown as Budget)
    .filter(([key, value]) => held.has(key) && value < (held.get(key) ?? 0))
    .map(([key, value]) => `${key} fell to ${value}: run node scripts/surface-budget.mjs`);
}

/** The text after the first 'Idle cost:' of a decision, up to the next '|' or the end of the line; null when there is none or it is empty. */
export function idleCostOf(decisionText: string): string | null {
  const at = decisionText.indexOf("Idle cost:");
  if (at < 0) return null;
  const rest = decisionText.slice(at + "Idle cost:".length);
  const end = rest.search(/\||\n/);
  const text = (end < 0 ? rest : rest.slice(0, end)).trim();
  return text.length > 0 ? text : null;
}
