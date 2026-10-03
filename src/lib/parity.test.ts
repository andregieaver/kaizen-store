import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  biggestGaps,
  decisionIds,
  domainScores,
  evidenceDebt,
  firstSentence,
  headlineOf,
  markerProblems,
  movesSince,
  outOfDate,
  parseRowFiles,
  pct,
  projectWaves,
  ratingOn,
  renderDetail,
  renderSections,
  renderText,
  scoreOf,
  validateRows,
  writeSections,
  type ParityRow,
  type Rating,
} from "./parity";

const EXISTING = new Set(["src/a.ts", "src/a.test.ts", "src/b.ts"]);
const options = { fileExists: (p: string) => EXISTING.has(p), today: "2026-10-03" };

type Patch = Partial<Omit<ParityRow, "kaizen" | "shopify" | "evidence">> & {
  rating?: Rating;
  was?: Rating | null;
  tier?: ParityRow["shopify"]["tier"];
  shopify?: Partial<ParityRow["shopify"]>;
  evidence?: Partial<ParityRow["evidence"]>;
};

/** A valid row: Full with evidence, unless the patch says otherwise. */
function row(slug: string, patch: Patch = {}): ParityRow {
  const { rating = "full", was = null, tier = "native", shopify, evidence, ...rest } = patch;
  const full = rating === "full";
  return {
    id: `catalogue.${slug}`,
    domain: "catalogue",
    feature: slug.replace(/-/g, " "),
    weight: 3,
    shopify: { tier, text: "Native.", url: "https://help.shopify.com/x", fetched: true, checkedOn: "2026-10-03", ...shopify },
    kaizen: { rating, rechecked: true, was },
    gap: full ? "" : "Something is lacking.",
    bucket: full ? null : "A",
    wave: full ? null : 1,
    criteria: ["It works."],
    evidence: { files: ["src/a.ts"], tests: ["src/a.test.ts"], untested: false, ...evidence },
    decisions: ["D1"],
    history: [],
    ...rest,
  };
}

function problemsOf(r: unknown, extra: Partial<typeof options & { knownDecisions: Set<string> }> = {}) {
  return validateRows([r], { ...options, ...extra }).map((p) => p.rule);
}

describe("validateRows", () => {
  it("accepts a Full row with evidence and a Partial row with a plan", () => {
    expect(validateRows([row("one"), row("two", { rating: "partial" })], options)).toEqual([]);
  });

  it("checks ids: shape, domain prefix and uniqueness", () => {
    expect(problemsOf(row("Bad Slug"))).toContain("id");
    expect(problemsOf({ ...row("one"), id: "orders.one" })).toContain("id");
    expect(problemsOf({ ...row("one"), id: "one" })).toContain("id");
    expect(validateRows([row("one"), row("one")], options).map((p) => p.rule)).toContain("id-unique");
    expect(validateRows([row("3pl-and-more")], options)).toEqual([]);
  });

  it("checks the enums and the weight", () => {
    expect(problemsOf({ ...row("one"), domain: "shipping" })).toContain("domain");
    expect(problemsOf(row("one", { tier: "free" as never }))).toContain("tier");
    expect(problemsOf({ ...row("one"), kaizen: { rating: "great", rechecked: true, was: null } })).toContain("rating");
    for (const weight of [0, 6, 2.5, "3"]) expect(problemsOf({ ...row("one"), weight })).toContain("weight");
    for (const weight of [1, 5]) expect(problemsOf({ ...row("one"), weight })).not.toContain("weight");
  });

  it("does not crash on junk", () => {
    expect(validateRows([null, 3, "x", {}], options).length).toBeGreaterThan(4);
  });

  describe("Full needs evidence", () => {
    it("wants a file, and a test or untested: true", () => {
      expect(problemsOf(row("one", { evidence: { files: [] } }))).toContain("full-evidence");
      expect(problemsOf(row("one", { evidence: { tests: [] } }))).toContain("full-evidence");
      expect(problemsOf(row("one", { evidence: { tests: [], untested: true } }))).toEqual([]);
    });

    it("wants every listed path to exist, in files and in tests, for any rating", () => {
      expect(problemsOf(row("one", { evidence: { files: ["src/missing.ts"] } }))).toContain("evidence-path");
      expect(problemsOf(row("one", { evidence: { tests: ["src/missing.test.ts"] } }))).toContain("evidence-path");
      expect(problemsOf(row("one", { rating: "partial", evidence: { files: ["src/missing.ts"] } }))).toContain("evidence-path");
      expect(problemsOf(row("one", { evidence: { files: ["/etc/passwd"] } }))).toContain("evidence-path");
      expect(problemsOf(row("one", { evidence: { files: ["../x.ts"] } }))).toContain("evidence-path");
    });

    it("has no bucket and no wave", () => {
      expect(problemsOf(row("one", { bucket: "A" }))).toContain("full-fields");
      expect(problemsOf(row("one", { wave: 2 }))).toContain("full-fields");
    });
  });

  describe("Partial and missing rows", () => {
    it("need a gap, a bucket, criteria; the wave may be null", () => {
      expect(problemsOf(row("one", { rating: "missing", gap: " " }))).toContain("gap");
      expect(problemsOf(row("one", { rating: "partial", bucket: null }))).toContain("bucket");
      expect(problemsOf(row("one", { rating: "partial", criteria: [] }))).toContain("criteria");
      expect(problemsOf(row("one", { rating: "partial", wave: null }))).toEqual([]);
    });

    it("keeps buckets and waves in range", () => {
      expect(problemsOf({ ...row("one", { rating: "partial" }), bucket: "E" })).toContain("bucket");
      for (const wave of [0, 10, 1.5]) expect(problemsOf(row("one", { rating: "partial", wave }))).toContain("wave");
      expect(problemsOf(row("one", { rating: "partial", wave: 9, bucket: "D" }))).toEqual([]);
    });
  });

  describe("the Shopify side", () => {
    it("fetched needs a url and a checkedOn", () => {
      expect(problemsOf(row("one", { shopify: { url: undefined } }))).toContain("fetched");
      expect(problemsOf(row("one", { shopify: { checkedOn: undefined } }))).toContain("fetched");
      expect(problemsOf(row("one", { shopify: { url: "http://help.shopify.com/x" } }))).toContain("fetched");
      expect(problemsOf(row("one", { shopify: { checkedOn: "03/10/2026" } }))).toContain("fetched");
      expect(problemsOf(row("one", { shopify: { checkedOn: "2026-02-30" } }))).toContain("fetched");
      expect(problemsOf(row("one", { shopify: { checkedOn: "2026-10-04" } }))).toContain("fetched");
    });

    it("a row that was not fetched needs neither, and says why in its text", () => {
      expect(problemsOf(row("one", { shopify: { fetched: false, url: null, checkedOn: undefined, text: "From memory: page not found." } }))).toEqual([]);
      expect(problemsOf(row("one", { shopify: { fetched: false, text: "" } }))).toContain("shopify");
    });
  });

  describe("history", () => {
    const move = (from: Rating, to: Rating, on = "2026-10-03") => ({ on, from, to, why: "Read the code." });

    it("is required when the rating differs from kaizen.was", () => {
      expect(problemsOf(row("one", { rating: "full", was: "partial" }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [move("partial", "full")] }))).toEqual([]);
    });

    it("must end at the rating and start at was", () => {
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [move("partial", "missing")] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "missing", history: [move("partial", "full")] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: null, history: [move("partial", "full")] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "partial" }))).toContain("history");
    });

    it("is a chain in date order whose entries change the rating and say why", () => {
      const chain = [move("missing", "partial", "2026-10-02"), move("partial", "full", "2026-10-03")];
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: chain }))).toEqual([]);
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [chain[1], chain[0]] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [move("missing", "partial"), move("missing", "full")] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "full", history: [move("full", "full")] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [{ ...move("partial", "full"), why: "" }] }))).toContain("history");
      expect(problemsOf(row("one", { rating: "full", was: "partial", history: [move("partial", "full", "2026-10-09")] }))).toContain("history");
    });
  });

  it("checks decision ids against the decisions file when it is given", () => {
    expect(problemsOf(row("one", { decisions: ["153"] }))).toContain("decisions");
    const known = new Set(["D1"]);
    expect(problemsOf(row("one"), { knownDecisions: known })).toEqual([]);
    expect(problemsOf(row("one", { decisions: ["D999"] }), { knownDecisions: known })).toContain("decisions");
  });
});

describe("decisionIds and parseRowFiles", () => {
  it("reads the table rows of docs/decisions.md", () => {
    const ids = decisionIds("| ID | Decision |\n| D12 | **x** |\n| D153 | y |\nD7 in prose |\n");
    expect([...ids].sort()).toEqual(["D12", "D153"]);
  });

  it("reports bad JSON, a file that is not a list and rows filed under another domain", () => {
    const ok = JSON.stringify([row("one")]);
    expect(parseRowFiles([{ name: "catalogue.json", text: ok }])).toEqual({ rows: [row("one")], problems: [] });
    expect(parseRowFiles([{ name: "catalogue.json", text: "{" }]).problems[0].rule).toBe("json");
    expect(parseRowFiles([{ name: "catalogue.json", text: "{}" }]).problems[0].rule).toBe("json");
    expect(parseRowFiles([{ name: "orders.json", text: ok }]).problems[0].rule).toBe("domain");
    expect(parseRowFiles([{ name: "notes.json", text: "[]" }]).problems[0].rule).toBe("domain");
  });
});

describe("scoring", () => {
  const rows = [
    row("a", { weight: 5 }), // full
    row("b", { weight: 4, rating: "partial" }),
    row("c", { weight: 1, rating: "missing" }),
    row("d", { weight: 2, tier: "app" }),
    row("e", { weight: 3, tier: "plus", rating: "partial" }),
  ];

  it("counts full 1, partial 0.5, missing 0, times the weight", () => {
    const s = scoreOf(rows.slice(0, 3));
    expect(s).toMatchObject({ rows: 3, weight: 10, points: 7, full: 1, partial: 1, missing: 1 });
    expect(s.weighted).toBeCloseTo(0.7);
    expect(s.unweighted).toBeCloseTo(0.5);
    expect(scoreOf([]).weighted).toBe(0);
  });

  it("makes the headline from native rows, must-haves from weight 4 and 5, then core+app, then all", () => {
    const h = headlineOf(rows);
    expect(h.core.rows).toBe(3);
    expect(h.mustHave.rows).toBe(2);
    expect(h.mustHave.weighted).toBeCloseTo(7 / 9);
    expect(h.coreApp.rows).toBe(4);
    expect(h.all.rows).toBe(5);
    expect(h.all.weighted).toBeCloseTo((7 + 2 + 1.5) / 15);
  });

  it("takes ratings from a function when asked", () => {
    expect(scoreOf(rows, () => "full").weighted).toBe(1);
  });

  it("formats a percentage to one decimal", () => {
    expect(pct(0.595)).toBe("59.5%");
    expect(pct(1)).toBe("100.0%");
    expect(pct(0.58649)).toBe("58.6%");
  });

  it("scores each domain on core rows only", () => {
    const orders = { ...row("o", { rating: "missing" }), id: "orders.o", domain: "orders" as const };
    const scores = domainScores([...rows, orders]);
    expect(scores.find((d) => d.domain === "catalogue")?.core.rows).toBe(3);
    expect(scores.find((d) => d.domain === "orders")?.core.weighted).toBe(0);
    expect(scores.find((d) => d.domain === "ai")?.core.rows).toBe(0);
  });
});

describe("evidence debt", () => {
  it("counts Full with tests, Full untested, unfetched Shopify rows and rows by bucket", () => {
    const rows = [
      row("a"),
      row("b", { evidence: { tests: [], untested: true } }),
      row("c", { rating: "partial", bucket: "B" }),
      row("d", { rating: "missing", bucket: "D", tier: "app", weight: 2 }),
      row("e", { rating: "missing", bucket: "A", shopify: { fetched: false } }),
    ];
    const debt = evidenceDebt(rows);
    expect(debt).toMatchObject({ fullWithTests: 1, fullUntested: 1, fullUntestedIds: ["catalogue.b"], unfetched: 1, unfetchedIds: ["catalogue.e"] });
    const bucket = (b: string) => debt.byBucket.find((x) => x.bucket === b);
    expect(bucket("A")).toMatchObject({ rows: 1, coreRows: 1 });
    expect(bucket("B")).toMatchObject({ rows: 1, coreRows: 1 });
    expect(bucket("D")).toMatchObject({ rows: 1, coreRows: 0, corePoints: 0 });
    // Core weight 3+3+3+3 = 12; the partial row lacks 1.5 and the missing one 3.
    expect(bucket("A")?.corePoints).toBeCloseTo(25);
    expect(bucket("B")?.corePoints).toBeCloseTo(12.5);
  });
});

describe("projection per wave", () => {
  const rows = [
    row("full", { weight: 2 }),
    row("w1", { rating: "missing", weight: 2, wave: 1, bucket: "A" }),
    row("w2b", { rating: "missing", weight: 2, wave: 2, bucket: "B" }),
    row("w2a", { rating: "partial", weight: 4, wave: 2, bucket: "A" }),
    row("none", { rating: "missing", weight: 2, wave: null, bucket: "A" }),
    row("c", { rating: "missing", weight: 2, wave: 3, bucket: "C" }),
    row("app", { rating: "missing", weight: 5, tier: "app", wave: 1, bucket: "A" }),
  ];
  // Core: full 2, w1 2, w2b 2, w2a 4, none 2, c 2 = weight 14; points 2 + 2 = 4.

  it("starts at the score now", () => {
    expect(projectWaves(rows).now.core.weighted).toBeCloseTo(4 / 14);
  });

  it("is cumulative: a wave makes every row planned up to it Full, bucket or not", () => {
    const { steps } = projectWaves(rows);
    expect(steps[0].all.core.weighted).toBeCloseTo((4 + 2) / 14);
    expect(steps[1].all.core.weighted).toBeCloseTo((4 + 2 + 2 + 2) / 14);
    expect(steps[2].all.core.weighted).toBeCloseTo((4 + 2 + 2 + 2 + 2) / 14);
    expect(steps[8].all.core.weighted).toBeCloseTo(steps[2].all.core.weighted);
    expect(steps[1].added).toBeCloseTo(((4 + 2 + 2 + 2) / 14 - (4 + 2) / 14) * 100);
    expect(steps[1]).toMatchObject({ rows: 2, coreRows: 2, name: "Data in and out" });
    // The app row is planned for wave 1 but is outside the headline.
    expect(steps[0]).toMatchObject({ rows: 2, coreRows: 1 });
  });

  it("the buildable line leaves buckets B, C and D as they are", () => {
    const { steps } = projectWaves(rows);
    expect(steps[1].buildable.core.weighted).toBeCloseTo((4 + 2 + 2) / 14);
    expect(steps[2].buildable.core.weighted).toBeCloseTo((4 + 2 + 2) / 14);
  });

  it("gives the ceilings and the rows with no wave", () => {
    const p = projectWaves(rows);
    expect(p.unplanned).toEqual({ rows: 1, coreRows: 1 });
    expect(p.ceilingA.core.weighted).toBeCloseTo((4 + 2 + 2 + 2) / 14);
    expect(p.ceilingAB.core.weighted).toBeCloseTo((4 + 2 + 2 + 2 + 2) / 14);
  });

  it("is measured on must-haves too", () => {
    const p = projectWaves([row("a", { weight: 4, rating: "missing", wave: 1 }), row("b", { weight: 4 })]);
    expect(p.now.mustHave.weighted).toBeCloseTo(0.5);
    expect(p.steps[0].all.mustHave.weighted).toBe(1);
  });
});

describe("rating over time", () => {
  const moved = row("m", {
    rating: "full",
    was: "partial",
    history: [
      { on: "2026-10-02", from: "missing", to: "partial", why: "First recheck." },
      { on: "2026-10-03", from: "partial", to: "full", why: "Shipped." },
    ],
  });

  it("gives the rating at the end of a day", () => {
    expect(ratingOn(moved, "2026-10-01")).toBe("missing");
    expect(ratingOn(moved, "2026-10-02")).toBe("partial");
    expect(ratingOn(moved, "2026-10-03")).toBe("full");
    expect(ratingOn(row("still", { rating: "partial" }), "2026-01-01")).toBe("partial");
  });

  it("lists the moves after a day", () => {
    const moves = movesSince([moved, row("other")], "2026-10-02");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ id: "catalogue.m", from: "partial", to: "full", core: true });
  });

  it("shortens a reason to its first sentence", () => {
    expect(firstSentence("Read the code. Then more.")).toBe("Read the code.");
    expect(firstSentence("No full stop here")).toBe("No full stop here");
    expect(firstSentence("a".repeat(300), 20)).toHaveLength(20);
  });
});

describe("biggest gaps", () => {
  it("lists native rows below Full with weight 4 or 5: weight, then wave (none last), then missing before partial", () => {
    const rows = [
      row("w4-wave2", { rating: "partial", weight: 4, wave: 2 }),
      row("w5-none", { rating: "missing", weight: 5, wave: null }),
      row("w5-wave3-partial", { rating: "partial", weight: 5, wave: 3 }),
      row("w5-wave3-missing", { rating: "missing", weight: 5, wave: 3 }),
      row("w4-full", { weight: 4 }),
      row("w3", { rating: "missing", weight: 3 }),
      row("w5-app", { rating: "missing", weight: 5, tier: "app" }),
    ];
    expect(biggestGaps(rows).map((r) => r.id.slice(10))).toEqual(["w5-wave3-missing", "w5-wave3-partial", "w5-none", "w4-wave2"]);
  });
});

describe("the Markdown", () => {
  const rows = [row("one"), row("two", { rating: "partial", gap: "Needs a | pipe\nand a line." })];

  it("escapes pipes and line breaks in table cells and marks a moved rating", () => {
    const detail = renderDetail([{ ...rows[1], kaizen: { rating: "partial", rechecked: true, was: "full" } }], "catalogue");
    expect(detail).toContain("Needs a \\| pipe and a line.");
    expect(detail).toContain("Partial (was full)");
    expect(detail.split("\n")).toHaveLength(3);
  });

  it("says untested Full rows are untested", () => {
    expect(renderDetail([row("one", { evidence: { tests: [], untested: true } })], "catalogue")).toContain("**untested**");
  });

  it("makes one section per name, a detail table for every domain", () => {
    const sections = renderSections(rows, "2026-10-02");
    expect(Object.keys(sections).sort()).toEqual(
      [
        "since", "summary", "headline", "domains", "evidence", "projection", "gaps",
        ...["catalogue", "storefront", "checkout", "orders", "customers", "analytics", "international", "platform", "ai"].map((d) => `detail-${d}`),
      ].sort(),
    );
  });

  it("prints the terminal report", () => {
    const text = renderText(rows);
    for (const heading of ["Headline", "By domain", "Evidence debt", "Projection"]) expect(text).toContain(heading);
  });
});

describe("generated sections in a document", () => {
  const doc = [
    "# Title",
    "Prose before.",
    "<!-- parity:generated:start alpha -->",
    "old alpha",
    "<!-- parity:generated:end alpha -->",
    "Prose between.",
    "<!-- parity:generated:start beta -->",
    "<!-- parity:generated:end beta -->",
    "Prose after.",
  ].join("\n");
  const sections = { alpha: "new alpha\n\nline two", beta: "new beta" };

  it("rewrites only what lies between the markers and is idempotent", () => {
    const next = writeSections(doc, sections);
    expect(next).toContain("Prose before.\n<!-- parity:generated:start alpha -->\n\nnew alpha\n\nline two\n\n<!-- parity:generated:end alpha -->\nProse between.");
    expect(next).not.toContain("old alpha");
    expect(next.endsWith("Prose after.")).toBe(true);
    expect(writeSections(next, sections)).toBe(next);
  });

  it("says which sections are out of date", () => {
    const next = writeSections(doc, sections);
    expect(outOfDate(next, sections)).toEqual([]);
    expect(outOfDate(next.replace("new beta", "edited by hand"), sections)).toEqual(["beta"]);
    expect(outOfDate(doc, sections)).toEqual(["alpha", "beta"]);
  });

  it("finds missing, unknown, duplicate and unclosed markers", () => {
    expect(markerProblems(doc, sections)).toEqual([]);
    expect(markerProblems(doc, { ...sections, gamma: "x" }).join()).toContain('no marker for generated section "gamma"');
    expect(markerProblems(doc, { alpha: "x" }).join()).toContain('"beta" that nothing generates');
    expect(markerProblems(doc + "\n<!-- parity:generated:start alpha -->\n<!-- parity:generated:end alpha -->", sections).join()).toContain("appears twice");
    expect(markerProblems("<!-- parity:generated:start alpha -->", { alpha: "x" }).join()).toContain("never closed");
    expect(markerProblems("<!-- parity:generated:end alpha -->", {}).join()).toContain("no matching start");
  });
});

describe("the real tracker", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const rowsDir = path.join(root, "docs", "parity", "rows");
  const files = readdirSync(rowsDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, text: readFileSync(path.join(rowsDir, name), "utf8") }));
  const parsed = parseRowFiles(files);

  it("has a file for every domain, and the rows keep every rule", () => {
    expect(files.map((f) => f.name.replace(/\.json$/, "")).sort()).toEqual(
      ["ai", "analytics", "catalogue", "checkout", "customers", "international", "orders", "platform", "storefront"],
    );
    const problems = [
      ...parsed.problems,
      ...validateRows(parsed.rows, {
        fileExists: (p) => existsSync(path.join(root, p)),
        knownDecisions: decisionIds(readFileSync(path.join(root, "docs", "decisions.md"), "utf8")),
        today: new Date().toISOString().slice(0, 10),
      }),
    ];
    expect(problems.map((p) => `${p.id} [${p.rule}] ${p.message}`)).toEqual([]);
  });

  it("is the data docs/shopify-parity.md is generated from: run pnpm parity:write when this fails", () => {
    const doc = readFileSync(path.join(root, "docs", "shopify-parity.md"), "utf8");
    const sections = renderSections(parsed.rows as ParityRow[], "2026-10-02");
    expect(markerProblems(doc, sections)).toEqual([]);
    expect(outOfDate(doc, sections)).toEqual([]);
  });

  it("scores to the figures the report prints", () => {
    const h = headlineOf(parsed.rows as ParityRow[]);
    const doc = readFileSync(path.join(root, "docs", "shopify-parity.md"), "utf8");
    expect(doc).toContain(`**${pct(h.core.weighted)}**`);
    expect(doc).toContain(`**${pct(h.mustHave.weighted)}**`);
  });
});
