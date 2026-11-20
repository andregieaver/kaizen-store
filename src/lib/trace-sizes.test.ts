import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { budgetsFrom, checkBudgets, missingTaxonomy, packageName, raised, summarise, TAXONOMY_FILES, TAXONOMY_ROUTES } from "../../scripts/trace-sizes.mjs";

const MIB = 1048576;
const file = (path: string, mb: number) => ({ file: path, size: mb * MIB });

/** Three traces: the health route, the visit route and the store home, which share one file and differ in what else they carry. */
const SHARED = file("/repo/node_modules/.pnpm/next@1/node_modules/next/dist/server.js", 10);
const traces = [
  { name: "app/api/health/route.js.nft.json", files: [SHARED, file("/repo/.next/server/chunks/a.js", 1)] },
  {
    name: "app/api/visit/route.js.nft.json",
    files: [SHARED, file("/repo/node_modules/.pnpm/sharp@0.35.5/node_modules/sharp/lib.node", 20), file("/repo/src/data/product-taxonomy/x.json", 5)],
  },
  {
    name: "app/s/[store]/[market]/(shop)/page.js.nft.json",
    files: [SHARED, file("/repo/node_modules/.pnpm/sharp@0.35.5/node_modules/sharp/lib.node", 20), file("/repo/.next/server/chunks/b.js.map", 2)],
  },
];

describe("trace sizes (bloat review 1.8)", () => {
  const summary = summarise(traces);

  it("counts a file two traces share in both, and takes the middle trace as the median", () => {
    expect(summary.sizes.health).toBe(11 * MIB);
    expect(summary.sizes.visit).toBe(35 * MIB);
    expect(summary.sizes.storeHome).toBe(32 * MIB);
    expect(summary.sizes.median).toBe(32 * MIB);
    expect(summary.sizes.proxy).toBeNull();
    const next = summary.packages.find((p) => p.name === "next");
    expect(next).toEqual({ name: "next", bytes: 30 * MIB, traces: 3 });
    expect(summary.packages[0].name).toBe("sharp");
  });

  it("counts the traces that carry sharp, the taxonomy and a map", () => {
    expect(summary.counts).toMatchObject({ sharp: 2, taxonomy: 1, maps: 1, chromium: 0, reactDom: 0, publicFiles: 0 });
  });

  it("names the package after the last node_modules segment, scoped names whole", () => {
    expect(packageName("/r/node_modules/.pnpm/@img+sharp@1/node_modules/@img/sharp-linux/x.node")).toBe("@img/sharp-linux");
    expect(packageName("/r/src/data/x.json")).toBeNull();
  });

  it("a count or a size over its budget makes the check return a line that names it", () => {
    const budgets = budgetsFrom(summary);
    expect(checkBudgets(summary, budgets)).toEqual([]);
    const lines = checkBudgets(summary, { sizesMb: { ...budgets.sizesMb, visit: 30 }, counts: { ...budgets.counts, sharp: 1 } });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("/api/visit's trace");
    expect(lines[1]).toContain("traces that carry sharp");
    expect(lines[1]).toContain("budget 1");
  });

  it("writes budgets 4% over the build, rounded up to 0.1, and says what a rewrite would raise", () => {
    const budgets = budgetsFrom(summary);
    expect(budgets.sizesMb.visit).toBe(36.4);
    expect(raised(budgets, { sizesMb: { visit: 30 }, counts: { sharp: 1 } })).toEqual([
      "/api/visit's trace: 30 MB → 36.4 MB",
      "traces that carry sharp: 1 → 2",
    ]);
  });
  it("gives a count that grows with every page room of max(20, 4 %), and a small count none", () => {
    const at = (sharp: number, chromium: number) => ({ sizes: {}, counts: { sharp, chromium } }) as unknown as Parameters<typeof checkBudgets>[0];
    const budgets = { sizesMb: {}, counts: { sharp: 776, chromium: 14 } };
    expect(checkBudgets(at(808, 14), budgets)).toEqual([]);
    expect(checkBudgets(at(809, 14), budgets).join()).toContain("with room 32");
    expect(checkBudgets(at(776, 15), budgets).join()).toContain("budget 14.");
  });

  it("fails a route that reads the taxonomy when its trace lacks a file the reader opens (bloat review 2.23)", () => {
    expect([...TAXONOMY_FILES].sort()).toEqual(readdirSync(path.join(process.cwd(), "src/data/product-taxonomy")).filter((f) => f.endsWith(".json")).sort());
    const all = TAXONOMY_FILES.map((f: string) => file(`/repo/src/data/product-taxonomy/${f}`, 1));
    const routes = Object.keys(TAXONOMY_ROUTES);
    const full = routes.map((name) => ({ name, files: [SHARED, ...all] }));
    expect(missingTaxonomy(full)).toEqual([]);
    const short = full.map((t, i) => (i === 0 ? { ...t, files: t.files.filter((f) => !f.file.endsWith("names-sv.json")) } : t));
    expect(missingTaxonomy(short)).toEqual([expect.stringContaining("lacks names-sv.json")]);
    expect(missingTaxonomy(full.slice(1)).join()).toContain("no trace at .next/server/app/s/[store]/[market]/(shop)/p/[handle]/page.js.nft.json");
  });
});
