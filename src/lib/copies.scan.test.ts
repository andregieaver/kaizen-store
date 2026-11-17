import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { exactCopies, forgetSources, nearCopies, repeatedHelpers, twinPairs } from "../../scripts/lib/copy-count.mjs";
import baseline from "./copies.baseline.json";

/**
 * The copies budget (bloat review step 1.17, CP-14, FM-13 and FM-7): lines copied exactly across files and inside one file, lines
 * copied once names and literals are blanked, twin pairs of files and helpers declared with identical text in three files, as
 * `copies.baseline.json` records them. A rise fails and says the fix; a copy made on purpose is recorded with
 * `node scripts/copies.mjs --write --reason "…"`. A fall is a note, never a failure: `node scripts/copies.mjs --write` lowers the
 * numbers (a fall of more than 50 lines or 2 helpers is printed here).
 */

const FIX = `A second kind of an existing thing extends the first one's engine with a scope; if the copy is on purpose run node scripts/copies.mjs --write --reason "why, at least 20 characters".`;
const NEAR_ROOM = 250;
const FALL_NOTE_LINES = 50;
const FALL_NOTE_NAMES = 2;

type Pair = { a: string; b: string; windows: number };
type Family = { files: number; places: number; lines: number; at: string[] };
type Helpers = { names: number; declarations: number; list: Array<{ name: string; files: string[] }> };

let exact: { acrossFiles: number; insideFiles: number; pairs: Pair[] };
let near: { lines: number; families: Family[] };
let twins: string[];
let helpers: Helpers;

beforeAll(() => {
  const root = process.cwd();
  exact = exactCopies(root);
  near = nearCopies(root);
  twins = twinPairs(root);
  helpers = repeatedHelpers(root);
}, 120_000);

const largestPairs = () => exact.pairs.slice(0, 20).map((p) => `${p.windows} windows: ${p.a} <> ${p.b}`).join("\n  ");
const tenFamilies = () => near.families.slice(0, 10).map((f) => `${f.files} files, ${f.lines} lines: ${f.at.slice(0, 3).join(", ")}`).join("\n  ");

/** The numbers that fell far enough to be worth a note (the pure part of the fall check, proved below). */
function copiesFallen(now: { exactAcrossFiles: number; exactInsideFiles: number; repeatedHelperNames: number; repeatedHelperDeclarations: number }, held: typeof now) {
  return [
    ...(now.exactAcrossFiles < held.exactAcrossFiles - FALL_NOTE_LINES ? [`exact copies across files fell to ${now.exactAcrossFiles}, baseline ${held.exactAcrossFiles}`] : []),
    ...(now.exactInsideFiles < held.exactInsideFiles - FALL_NOTE_LINES ? [`exact copies inside files fell to ${now.exactInsideFiles}, baseline ${held.exactInsideFiles}`] : []),
    ...(now.repeatedHelperNames < held.repeatedHelperNames - FALL_NOTE_NAMES ? [`repeated helpers fell to ${now.repeatedHelperNames}, baseline ${held.repeatedHelperNames}`] : []),
    ...(now.repeatedHelperDeclarations < held.repeatedHelperDeclarations - FALL_NOTE_LINES ? [`helper declarations fell to ${now.repeatedHelperDeclarations}, baseline ${held.repeatedHelperDeclarations}`] : []),
  ];
}

describe("the copies budget (bloat review 1.17)", () => {
  it("adds no exact copy across files", () => {
    expect(exact.acrossFiles, `exact copied lines across files. ${FIX}\nThe twenty largest pairs:\n  ${largestPairs()}`).toBeLessThanOrEqual(baseline.exactAcrossFiles);
  });

  it("adds no exact copy inside a file", () => {
    expect(exact.insideFiles, `exact copied lines inside one file. ${FIX}\nThe twenty largest pairs across files, for the shape:\n  ${largestPairs()}`).toBeLessThanOrEqual(baseline.exactInsideFiles);
  });

  it(`adds no more than ${NEAR_ROOM} near-copied lines (a renamed copy), the baseline plus its room`, () => {
    expect(near.lines, `near copied lines, baseline ${baseline.nearLines} plus ${NEAR_ROOM}. ${FIX}\nThe ten largest families:\n  ${tenFamilies()}`).toBeLessThanOrEqual(baseline.nearLines + NEAR_ROOM);
  });

  it("adds no twin pair, and every twin kept has its reason", () => {
    const held = baseline.twins as Record<string, { reason?: string }>;
    const added = twins.filter((pair) => !held[pair]).map((pair) => `${pair} is a new twin pair. ${FIX}`);
    expect(added).toEqual([]);
    const unreasoned = Object.entries(held)
      .filter(([, t]) => (t.reason ?? "").length < 20)
      .map(([pair]) => `${pair} has no reason of at least 20 characters in src/lib/copies.baseline.json`);
    expect(unreasoned).toEqual([]);
    // A twin folded since is a note: node scripts/copies.mjs --write drops it.
    const folded = Object.keys(held).filter((pair) => !twins.includes(pair));
    if (folded.length > 0) console.info(`copies: ${folded.length} baseline twins are no longer twins (run node scripts/copies.mjs --write): ${folded.join(", ")}`);
  });

  it("adds no helper identical in three or more files", () => {
    const where = helpers.list.slice(0, 10).map((h) => `${h.name} in ${h.files.length} files: ${h.files.slice(0, 3).join(", ")}`).join("\n  ");
    expect(helpers.names, `helpers declared with identical text in three or more files. ${FIX}\n  ${where}`).toBeLessThanOrEqual(baseline.repeatedHelperNames);
    expect(helpers.declarations, `declarations of those helpers. ${FIX}\n  ${where}`).toBeLessThanOrEqual(baseline.repeatedHelperDeclarations);
  });

  it("notes the numbers that fell: node scripts/copies.mjs --write lowers them", () => {
    const fallen = copiesFallen(
      { exactAcrossFiles: exact.acrossFiles, exactInsideFiles: exact.insideFiles, repeatedHelperNames: helpers.names, repeatedHelperDeclarations: helpers.declarations },
      baseline,
    );
    if (fallen.length > 0) console.info(`copies: ${fallen.join("; ")}. Run node scripts/copies.mjs --write to lower the baseline.`);
    const held = { exactAcrossFiles: 100, exactInsideFiles: 100, repeatedHelperNames: 10, repeatedHelperDeclarations: 100 };
    expect(copiesFallen({ ...held, exactAcrossFiles: 40 }, held)).toHaveLength(1);
    expect(copiesFallen({ ...held, exactAcrossFiles: 60, repeatedHelperNames: 9 }, held)).toEqual([]);
    expect(copiesFallen({ ...held, repeatedHelperNames: 7 }, held)).toHaveLength(1);
  });
});

describe("the detector would notice (on small trees)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "copies-"));
  const write = (name: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  };
  /** n lines of distinct code, each about 60 characters, named by `tag`. */
  const block = (n: number, tag: string) =>
    Array.from({ length: n }, (_, k) => `const ${tag}Value${k} = compute${k}(options.field${k}, "label for line ${k}");`).join("\n");
  /** A module whose lines follow twelve shapes in a pseudo-random order, every name made from `tag`. */
  const shapes = [
    (t: string, k: number) => `export function ${t}Run${k}(input${k}: Input) { return input${k}.rows.map((r) => ${t}Row${k}(r)); }`,
    (t: string, k: number) => `const ${t}Total${k} = items.reduce((sum, item) => sum + item.${t}Price${k} * item.quantity, ${k});`,
    (t: string, k: number) => `if (${t}Flag${k}.enabled && !${t}Flag${k}.hidden) { await ${t}Notify${k}("changed", ${k}); }`,
    (t: string, k: number) => `const ${t}Label${k} = await translate("${t}.label.${k}", { count: ${k}, locale: language });`,
    (t: string, k: number) => `return { ${t}Id${k}: row.id, ${t}Name${k}: row.name ?? "none", ${t}Count${k}: row.count + ${k} };`,
    (t: string, k: number) => `for (const ${t}Entry${k} of ${t}List${k}) { results.push(${t}Entry${k}.value * ${k}); }`,
    (t: string, k: number) => `const { data: ${t}Data${k}, error: ${t}Error${k} } = await ${t}Client${k}.fetch("/api/${k}");`,
    (t: string, k: number) => `throw new Error("${t} step ${k} failed: " + String(${t}Reason${k}).slice(0, ${k + 20}));`,
    (t: string, k: number) => `export const ${t}Limit${k}: number = Math.min(${t}Max${k}, Math.max(${k}, ${t}Min${k} + 12));`,
    (t: string, k: number) => `await db().insert(${t}Table${k}).values({ storeId, label: "${t} ${k}", at: ${t}Clock${k}() });`,
    (t: string, k: number) => `const ${t}Map${k} = new Map(${t}Rows${k}.map((row) => [row.key, row.value ?? ${k}] as const));`,
    (t: string, k: number) => `log("info", "${t}.done", { count: ${t}Rows${k}.length, took: ${t}Timer${k}.stop(), step: ${k} });`,
  ];
  const randomModule = (n: number, tag: string) => {
    let seed = 7;
    return Array.from({ length: n }, (_, k) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return shapes[Math.floor(seed / 65536) % shapes.length](tag, k);
    }).join("\n");
  };
  const helper = "export const formatAmount = (value: number, currency: string) => new Intl.NumberFormat(\"en\", { style: \"currency\", currency }).format(value / 100);";

  afterAll(() => {
    forgetSources();
    rmSync(dir, { recursive: true, force: true });
  });

  it("sees a 30-line block shared by two files (30 lines in each)", () => {
    forgetSources();
    write("src/a.ts", block(30, "one"));
    write("src/b.ts", block(30, "one"));
    expect(exactCopies(dir).acrossFiles).toBe(60);
    rmSync(path.join(dir, "src/b.ts"));
    write("src/b.ts", `${block(30, "two")}\n`);
    forgetSources();
    expect(exactCopies(dir).acrossFiles).toBe(0);
  });

  it("sees a 30-line block twice inside one file", () => {
    forgetSources();
    rmSync(path.join(dir, "src"), { recursive: true, force: true });
    write("src/a.ts", `${block(30, "one")}\nconst between = 1;\n${block(30, "one")}`);
    const found = exactCopies(dir);
    expect(found.acrossFiles).toBe(0);
    expect(found.insideFiles).toBeGreaterThanOrEqual(30);
  });

  it("sees a 300-line module copied with every name changed, and not a 20-line form that only resembles another", () => {
    forgetSources();
    rmSync(path.join(dir, "src"), { recursive: true, force: true });
    write("src/a.ts", randomModule(300, "alpha"));
    write("src/b.ts", randomModule(300, "beta"));
    expect(exactCopies(dir).acrossFiles).toBe(0);
    expect(nearCopies(dir).lines).toBeGreaterThanOrEqual(250);
    forgetSources();
    rmSync(path.join(dir, "src"), { recursive: true, force: true });
    const form = (fields: string[]) => fields.map((f, k) => `  <Field name="${f}" label={t("${f}.label")} value={values.${f}} onChange={(v) => set("${f}", v)} hint={hints[${k}]} />`).join("\n");
    write("src/a.tsx", form(Array.from({ length: 20 }, (_, k) => `title${k}`)));
    write("src/b.tsx", form(Array.from({ length: 20 }, (_, k) => `amount${k}x`)));
    expect(exactCopies(dir).acrossFiles).toBe(0);
    expect(nearCopies(dir).lines).toBeLessThan(250);
  });

  it("sees a helper pasted into a third file", () => {
    forgetSources();
    rmSync(path.join(dir, "src"), { recursive: true, force: true });
    write("src/a.ts", `${helper}\n`);
    write("src/b.ts", `${helper}\n`);
    const two = repeatedHelpers(dir);
    expect(two.names).toBe(0);
    forgetSources();
    write("src/c.ts", `${helper}\n`);
    const three = repeatedHelpers(dir);
    // The third copy makes the helper count: one name, three declarations (the brief said +1 and +1; a helper counts from its third file).
    expect(three.names - two.names).toBe(1);
    expect(three.declarations - two.declarations).toBe(3);
  });
});
