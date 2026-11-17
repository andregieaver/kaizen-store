import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { hotCounts, idleCostOf, scratchDatabase, SURFACE_HOT_TABLES, surfaceCounts, surfaceFallen, surfaceNotes, surfaceProblems, tableCount, type SurfaceCounts } from "../test/surface-count";

/**
 * The surface budget (bloat review step 1.18, findings FT-2 and DS-12): what every store carries whether it uses it or not, counted and
 * held in `surface-budget.baseline.json`. A new scheduled job, table, trigger, navigation link or AI tool fails until its decision row has
 * an `Idle cost:` line (per request, per scheduled run, per cold start; "none" where none), and `node scripts/surface-budget.mjs --raise
 * D<number>` writes the new figure and the decision it came with. Pages and route handlers grow in everyday work: a rise inside their room
 * is a note. A fall is a note too: `node scripts/surface-budget.mjs` lowers the baseline. The new-store count is measured and compared in
 * `src/db/commerce.test.ts`.
 */

const ROOT = process.cwd();
const FILE = path.join(ROOT, "src/lib/surface-budget.baseline.json");
const MODE = process.env.SURFACE_BUDGET ?? "";
const WRITING = MODE === "lower" || MODE === "first" || MODE.startsWith("raise:");

type Baseline = Omit<SurfaceCounts, never> & {
  newStoreRows: number;
  twins: Array<{ name: string; reason: string; decision: string }>;
  raises: Array<{ count: string; from: number; to: number; decision: string }>;
};

const COUNTS = ["dispatcherJobs", "minuteRoutes", "pages", "routeHandlers", "tables", "platformTables", "storeLinks", "basicLinks", "platformLinks", "storeTools", "shopOnlyTools", "managerTools", "featureIds", "newStoreRows"] as const;

const readBaseline = (): Baseline => JSON.parse(readFileSync(FILE, "utf8")) as Baseline;

/** The text of a decision: its row of docs/decisions.md, or docs/decisions/D<n>.md once the file is split. */
function decisionText(id: string): string {
  const folder = path.join(ROOT, "docs/decisions", `${id}.md`);
  if (existsSync(folder)) return readFileSync(folder, "utf8");
  const row = readFileSync(path.join(ROOT, "docs/decisions.md"), "utf8")
    .split("\n")
    .find((line) => line.startsWith(`| ${id} |`));
  return row ?? "";
}

let now: SurfaceCounts;
beforeAll(async () => {
  now = await surfaceCounts(ROOT);
}, 120_000);

const numbersOf = (c: SurfaceCounts) => ({ ...c }) as unknown as Record<string, number | object>;

describe.runIf(WRITING)("writing the surface baseline", () => {
  it("writes the baseline", () => {
    const old = existsSync(FILE) ? readBaseline() : undefined;
    const base = { newStoreRows: old?.newStoreRows ?? 8, twins: old?.twins ?? [], raises: old?.raises ?? [] };
    if (MODE === "lower" || MODE.startsWith("raise:")) {
      if (!old) throw new Error("There is no baseline yet: run node scripts/surface-budget.mjs --first");
    }
    if (MODE === "lower") {
      const rose = surfaceProblems(now, old as Baseline);
      if (rose.length > 0) throw new Error(`Something rose, so nothing is written:\n  ${rose.join("\n  ")}`);
    }
    const raises = [...base.raises];
    if (MODE.startsWith("raise:")) {
      const id = MODE.slice("raise:".length);
      if (idleCostOf(decisionText(id)) === null) {
        throw new Error(`${id} has no Idle cost: line. Write what the feature costs a store that does not use it: per request, per scheduled run and per cold start (none where none).`);
      }
      const held = numbersOf(old as Baseline);
      const fresh = numbersOf(now);
      for (const key of COUNTS) {
        if (typeof fresh[key] === "number" && typeof held[key] === "number" && fresh[key] > (held[key] as number)) raises.push({ count: key, from: held[key] as number, to: fresh[key], decision: id });
      }
      for (const [section, n] of Object.entries(now.storeLinksBySection)) {
        const was = (old as Baseline).storeLinksBySection[section];
        if (was !== undefined && n > was) raises.push({ count: `storeLinksBySection.${section}`, from: was, to: n, decision: id });
      }
      for (const table of SURFACE_HOT_TABLES) {
        for (const kind of ["indexes", "triggers"] as const) {
          const was = (old as Baseline).hot[table]?.[kind];
          if (was !== undefined && now.hot[table][kind] > was) raises.push({ count: `hot.${table}.${kind}`, from: was, to: now.hot[table][kind], decision: id });
        }
      }
    }
    writeFileSync(FILE, `${JSON.stringify({ ...now, newStoreRows: base.newStoreRows, twins: base.twins, raises }, null, 2)}\n`);
  });
});

describe.skipIf(WRITING)("the surface budget (bloat review 1.18)", () => {
  it("adds no job, table, trigger, link or tool without a raise", () => {
    const baseline = readBaseline();
    const notes = surfaceNotes(now, baseline);
    if (notes.length > 0) console.info(`surface: ${notes.join("; ")}`);
    expect(surfaceProblems(now, baseline)).toEqual([]);
  });

  it("is as low as the code: a fall is a note, and node scripts/surface-budget.mjs lowers the baseline", () => {
    const fallen = surfaceFallen(now, readBaseline());
    if (fallen.length > 0) console.info(`surface: ${fallen.join("; ")}`);
    expect(Array.isArray(fallen)).toBe(true);
  });

  it("holds fourteen counts and the eight hot tables", () => {
    const baseline = numbersOf(readBaseline());
    for (const key of COUNTS) expect(typeof baseline[key], key).toBe("number");
    expect(Object.keys(readBaseline().hot).sort()).toEqual([...SURFACE_HOT_TABLES].sort());
    expect(typeof readBaseline().newStoreRows).toBe("number");
  });

  it("names a decision with an idle cost for every raise", () => {
    const bad = readBaseline()
      .raises.filter((r) => idleCostOf(decisionText(r.decision)) === null)
      .map((r) => `${r.count} rose from ${r.from} to ${r.to} under ${r.decision}, which has no Idle cost: line`);
    expect(bad).toEqual([]);
  });

  it("gives every twin kept on purpose its reason and decision", () => {
    for (const twin of readBaseline().twins) {
      expect(twin.name, "a twin's name").toBeTruthy();
      expect(twin.reason.length, `${twin.name}: reason`).toBeGreaterThan(0);
      expect(twin.decision.length, `${twin.name}: decision (a D-number, or the finding that tolerates it)`).toBeGreaterThan(0);
    }
  });

  it("copies the hot tables of the migration rule", () => {
    const text = readFileSync(path.join(ROOT, "src/db/migration-safety.scan.test.ts"), "utf8");
    const listed = /export const HOT_TABLES = \[([^\]]+)\]/.exec(text)?.[1].match(/"(\w+)"/g)?.map((s) => s.replaceAll('"', ""));
    expect(SURFACE_HOT_TABLES).toEqual(listed);
  });

  it("would notice: the trials, on the pure functions", () => {
    // Against the code's own figures, so the trials do not depend on what the baseline holds today.
    const baseline = structuredClone(now);
    const more = structuredClone(now);
    more.dispatcherJobs += 1;
    expect(surfaceProblems(more, baseline).join()).toContain("dispatcherJobs");
    const fewer = structuredClone(now);
    fewer.pages -= 1;
    expect(surfaceFallen(fewer, baseline)).toEqual([expect.stringContaining("pages fell")]);
    const table = structuredClone(now);
    table.tables += 1;
    expect(surfaceProblems(table, baseline).join()).toContain("tables");
    const trigger = structuredClone(now);
    trigger.hot.orders.triggers += 1;
    expect(surfaceProblems(trigger, baseline).join()).toContain("hot.orders.triggers");
    // A page or two more is a note; a large rise is not.
    const pages = structuredClone(now);
    pages.pages += 3;
    expect(surfaceProblems(pages, baseline)).toEqual([]);
    expect(surfaceNotes(pages, baseline)).toHaveLength(1);
    pages.pages += 100;
    expect(surfaceProblems(pages, baseline).join()).toContain("pages");
    expect(idleCostOf("| D9 | **X.** Text.")).toBeNull();
    expect(idleCostOf("| D9 | **X.** Text. Idle cost: none per request; one statement per tick.")).toBe("none per request; one statement per tick.");
    expect(idleCostOf("| D9 | **X.** Idle cost: | more")).toBeNull();
  });

  it("reads the real thing: a table the schema file does not declare, and a trigger on orders", async () => {
    const baseline = readBaseline();
    const db = await scratchDatabase();
    try {
      await db.exec("create table commerce.surface_trial (id int)");
      expect(await tableCount(db)).toBe(baseline.tables + 1);
      const before = (await hotCounts(db)).orders.triggers;
      const fn = await db.query<{ name: string }>(
        "select t.tgfoid::regproc::text as name from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'commerce' and c.relname = 'orders' and not t.tgisinternal limit 1",
      );
      await db.exec(`create trigger surface_trial before update on commerce.orders for each row execute function ${fn.rows[0].name}()`);
      expect((await hotCounts(db)).orders.triggers).toBe(before + 1);
    } finally {
      await db.close();
    }
  }, 60_000);
});
