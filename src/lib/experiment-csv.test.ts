import { describe, expect, it } from "vitest";

import { writeCsv } from "./csv";
import { EXPERIMENT_CSV_COLUMNS, experimentCsvRows, type CsvTest } from "./experiment-csv";

const base: CsvTest = {
  name: "Bigger button",
  status: "running",
  goal: "cart",
  target: "/om-oss",
  startedAt: "2026-11-01T10:00:00.000Z",
  stoppedAt: null,
  appliedVariant: null,
  learning: null,
  variants: [
    { key: "a", name: "Original" },
    { key: "b", name: "Version B" },
  ],
  card: { state: "answer", showFigures: true, comparisons: [{ key: "b", original: 0.09, version: 0.117, relative: 0.29, low: 0.12, high: 0.48, side: "better", chanceBetter: 0.99 }] },
  figures: [
    { key: "a", name: "A", visitors: 2400, conversions: 218, money: null },
    { key: "b", name: "B", visitors: 2380, conversions: 279, money: null },
  ],
};

describe("experimentCsvRows", () => {
  it("writes a row per version, with its figures and the change against the original once there is an answer", () => {
    const rows = experimentCsvRows([base]);
    expect(rows[0]).toEqual([...EXPERIMENT_CSV_COLUMNS]);
    expect(rows).toHaveLength(3);
    expect(rows[1].slice(5, 13)).toEqual(["a", "Original", 2400, 218, { num: "0.0908" }, null, null, null]);
    expect(rows[2].slice(5, 13)).toEqual(["b", "Version B", 2380, 279, { num: "0.1172" }, { num: "0.2900" }, { num: "0.1200" }, { num: "0.4800" }]);
    expect(writeCsv(rows).split("\r\n")[2]).toBe("Bigger button,running,answer,cart,/om-oss,b,Version B,2380,279,0.1172,0.2900,0.1200,0.4800,2026-11-01T10:00:00.000Z,,,");
  });

  it("keeps everything but the visitors back while a test is still learning", () => {
    const rows = experimentCsvRows([{ ...base, card: { state: "learning", showFigures: false, comparisons: base.card.comparisons } }]);
    expect(rows[2].slice(7, 13)).toEqual([2380, null, null, null, null, null]);
  });

  it("writes a draft with its versions and no figures", () => {
    const rows = experimentCsvRows([{ ...base, status: "draft", startedAt: null, card: { state: "draft", showFigures: false, comparisons: [] }, figures: null }]);
    expect(rows[1].slice(1, 3)).toEqual(["draft", "draft"]);
    expect(rows[1][7]).toBeNull();
  });
});
