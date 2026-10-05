import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ANALYTICS_TABLES, NOT_EXPORTED, rawTableUses, tableUses } from "./analytics-export";

/**
 * The scan that holds "every analytics table can be downloaded" (D165, `docs/wave-2-data.md` 6.4): every table, chart and hand-made table in
 * `src/components/admin/analytics/` either names an `exportId` in `ANALYTICS_TABLES`, or says `exportable={false}` with an `exportReason` in
 * `NOT_EXPORTED`; and every table of the registry is drawn by the view it names. A new table fails this test until it is registered.
 *
 * This test belongs to the analytics area of the wave: it is red until its views carry the props (the registry and the scan helpers are the
 * foundation's).
 */
const DIR = path.join(process.cwd(), "src", "components", "admin", "analytics");

const files = readdirSync(DIR).filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f) && f !== "data-table.tsx" && f !== "charts.tsx");
const sources = new Map(files.map((f) => [f, readFileSync(path.join(DIR, f), "utf8")]));

describe("every analytics table has a download or says why not", () => {
  it("finds the tables and charts the views draw", () => {
    const total = [...sources.values()].reduce((n, s) => n + tableUses(s).length, 0);
    expect(total).toBeGreaterThan(40);
  });

  it("gives each a registered exportId, or exportable={false} with a reason that is in NOT_EXPORTED", () => {
    const problems: string[] = [];
    for (const [file, source] of sources) {
      for (const use of tableUses(source)) {
        const where = `${file}:${use.line} <${use.component}>`;
        if (use.exportable === null) problems.push(`${where} has no exportId and is not marked exportable={false}`);
        else if (use.exportable && use.exportId && !Object.hasOwn(ANALYTICS_TABLES, use.exportId)) problems.push(`${where} names exportId "${use.exportId}", which is not in ANALYTICS_TABLES`);
        else if (!use.exportable && (!use.exportId || !Object.hasOwn(NOT_EXPORTED, use.exportId))) problems.push(`${where} is exportable={false} without an exportReason that is in NOT_EXPORTED`);
      }
      for (const raw of rawTableUses(source)) {
        const known = raw.id !== null && (Object.hasOwn(ANALYTICS_TABLES, raw.id) || Object.hasOwn(NOT_EXPORTED, raw.id));
        if (!known) problems.push(`${file}:${raw.line} <table> has no data-export-id (or data-export-skip) that is registered`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("is drawn by the view the registry names, once or more, for every registered table", () => {
    const orphans: string[] = [];
    for (const t of Object.values(ANALYTICS_TABLES)) {
      const source = sources.get(t.view) ?? "";
      const used = tableUses(source).some((u) => u.exportId === t.id) || rawTableUses(source).some((u) => u.id === t.id);
      if (!used) orphans.push(`${t.id} is not drawn in ${t.view}`);
    }
    expect(orphans).toEqual([]);
  });
});
