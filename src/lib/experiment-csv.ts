import type { Cell } from "./csv";
import type { ExperimentCard } from "./experiment-card";
import type { VariantFigures } from "./experiment-results";
import type { ExperimentStatus, Goal } from "./experiments";

/**
 * The store's A/B tests as a CSV (D148 phase 15, `docs/ab-testing-usability.md` step 4): one row per version of each test, with the stage its
 * page shows. Like the page, the figures beyond the visitors (who did the thing, the rate, the change and its likely range) are written only
 * once the test has an answer, so a file opened early cannot be read as a result. Shares are plain decimals (0.112 is 11.2 %). Pure.
 */

export const EXPERIMENT_CSV_COLUMNS = [
  "test",
  "status",
  "stage",
  "goal",
  "target",
  "version",
  "version_name",
  "visitors",
  "did_it",
  "rate",
  "change",
  "change_low",
  "change_high",
  "started_at",
  "stopped_at",
  "applied_version",
  "learning",
] as const;

export type CsvTest = {
  name: string;
  status: ExperimentStatus;
  goal: Goal;
  target: string;
  startedAt: string | null;
  stoppedAt: string | null;
  appliedVariant: string | null;
  learning: string | null;
  variants: readonly { key: string; name: string }[];
  card: Pick<ExperimentCard, "state" | "showFigures" | "comparisons">;
  figures: readonly VariantFigures[] | null;
};

/** A share as a plain decimal with four places, or empty. */
const share = (value: number | null | undefined): Cell => (value === null || value === undefined || !Number.isFinite(value) ? null : { num: value.toFixed(4) });

export function experimentCsvRows(tests: readonly CsvTest[]): Cell[][] {
  const rows: Cell[][] = [[...EXPERIMENT_CSV_COLUMNS]];
  for (const t of tests) {
    const rate = t.goal !== "revenue";
    for (const v of t.variants) {
      const f = t.figures?.find((x) => x.key === v.key) ?? null;
      const c = t.card.comparisons.find((x) => x.key === v.key) ?? null;
      const shown = t.card.showFigures;
      rows.push([
        t.name,
        t.status,
        t.card.state,
        t.goal,
        t.target,
        v.key,
        v.name,
        f ? f.visitors : null,
        shown && f && rate ? f.conversions : null,
        shown && f && rate ? share(f.visitors > 0 ? f.conversions / f.visitors : 0) : null,
        shown && c ? share(c.relative) : null,
        shown && c ? share(c.low) : null,
        shown && c ? share(c.high) : null,
        t.startedAt,
        t.stoppedAt,
        t.appliedVariant,
        t.learning,
      ]);
    }
  }
  return rows;
}
