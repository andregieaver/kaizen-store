import { describe, expect, it } from "vitest";

import { FINDING_CODES, type FindingCode } from "./data-job";
import type { RedirectLine } from "./redirect-csv";
import {
  DEFAULT_REDIRECT_OPTIONS,
  countPlans,
  duplicateRows,
  parseRedirectOptions,
  planRedirectImport,
  planRedirectLines,
  redirectItemOf,
  writesOf,
  type LinePlan,
  type PlanEnv,
  type RedirectImportOptions,
} from "./redirect-plan";
import type { AddressContext } from "./redirect-path";
import { followChain, liveAddresses, type RedirectIndex } from "./redirects";

const ctx: AddressContext = { store: "demo", countries: ["no", "se"], ownHosts: ["shop.demo.no"] };
const live = liveAddresses({ products: ["lamp", "new-cup"], categories: ["shoes"], tags: [], pages: ["om-oss"], articles: [] });
const lines = (...pairs: [string, string][]): RedirectLine[] => pairs.map(([from, to], i) => ({ row: i + 2, from, to }));
const store = (manual: Record<string, string> = {}, automatic: Record<string, string | null> = {}): RedirectIndex => ({
  manual: new Map(Object.entries(manual)),
  automatic: new Map(Object.entries(automatic)),
});
const env = (over: Partial<PlanEnv> = {}): Omit<PlanEnv, "duplicates"> => ({ ctx, live, index: store(), manualCount: 0, options: DEFAULT_REDIRECT_OPTIONS, ...over });
const codesOf = (plan: LinePlan) => plan.findings.map((f) => f.code);

describe("the options", () => {
  it("are one choice: replace the target of an address that already has a redirect, or keep it", () => {
    expect(DEFAULT_REDIRECT_OPTIONS).toEqual({ existing: "replace" });
    expect(parseRedirectOptions({ existing: "skip" })).toEqual({ existing: "skip" });
    for (const junk of [null, undefined, {}, { existing: "delete" }, "skip", 5]) expect(parseRedirectOptions(junk)).toEqual({ existing: "replace" });
  });
});

describe("planning a file, one finding code at a time", () => {
  const plan = (pairs: [string, string][], over: Partial<PlanEnv> = {}) => planRedirectImport(lines(...pairs), env(over)).lines;

  it("creates a plain line, and plans nothing for the store yet", () => {
    const [p] = plan([["/collections/old", "/category/shoes"]]);
    expect(p).toMatchObject({ row: 2, source: "/collections/old", target: "/category/shoes", action: "create", outcome: "created", replacesAutomatic: false });
    expect(p.findings).toEqual([]);
  });

  it.each<[string, [string, string], FindingCode[]]>([
    ["a missing source", ["", "/category/shoes"], ["source.missing"]],
    ["an unreadable source", ["/a b", "/category/shoes"], ["source.invalid"]],
    ["a source on another website", ["https://evil.example/a", "/category/shoes"], ["source.external"]],
    ["a source with a country", ["/no/a", "/category/shoes"], ["source.market_prefix"]],
    ["a reserved source", ["/checkout", "/category/shoes"], ["source.reserved"]],
    ["a live source", ["/p/lamp", "/category/shoes"], ["source.live"]],
    ["the front page as a source", ["/", "/category/shoes"], ["source.root"]],
    ["a missing target", ["/a", ""], ["target.missing"]],
    ["an unreadable target", ["/a", "javascript:alert(1)"], ["target.invalid"]],
    ["a target on another website", ["/a", "https://evil.example/x"], ["target.external"]],
    ["a target equal to the source", ["/a", "/A"], ["target.self"]],
  ])("refuses %s", (_name, [from, to], expected) => {
    const [p] = plan([[from, to]]);
    expect(codesOf(p)).toEqual(expected);
    expect(p).toMatchObject({ action: "error", outcome: "failed", target: null });
  });

  it("notes a query string cut from the source and a country removed from the target, and still creates the line", () => {
    const [p] = plan([["/a?x=1", "/no/category/shoes"]]);
    expect(codesOf(p)).toEqual(["source.query_dropped", "target.market_removed"]);
    expect(p).toMatchObject({ action: "create", source: "/a", target: "/category/shoes" });
  });

  it("warns about a target that is not there, and creates the line", () => {
    const [p] = plan([["/a", "/category/none-yet"]]);
    expect(codesOf(p)).toEqual(["target.not_found"]);
    expect(p.action).toBe("create");
  });

  it("marks the later line of the same source, the first line wins", () => {
    const result = plan([["/a", "/category/shoes"], ["/A/", "/p/lamp"], ["/b", "/p/lamp"], ["/a", "/p/lamp"]]);
    expect(result.map((p) => p.action)).toEqual(["create", "error", "create", "error"]);
    expect(codesOf(result[1])).toEqual(["duplicate.in_file"]);
    expect(writesOf(result)).toEqual([
      { source: "/a", target: "/category/shoes", replacesAutomatic: false },
      { source: "/b", target: "/p/lamp", replacesAutomatic: false },
    ]);
  });

  it("collapses a chain through another line of the file, and a chain through a redirect the store has", () => {
    const result = plan([["/b", "/category/shoes"], ["/a", "/b"]]);
    expect(result[1]).toMatchObject({ action: "create", target: "/category/shoes" });
    expect(codesOf(result[1])).toEqual(["target.chain"]);
    const fromStore = plan([["/a", "/b"]], { index: store({ "/b": "/c", "/c": "/p/lamp" }) });
    expect(fromStore[0]).toMatchObject({ target: "/p/lamp" });
    expect(codesOf(fromStore[0])).toEqual(["target.chain"]);
  });

  it("refuses the line that closes a loop, with another line of the file or with a redirect the store has", () => {
    const inFile = plan([["/a", "/b"], ["/b", "/c"], ["/c", "/a"]]);
    expect(inFile.map((p) => p.action)).toEqual(["create", "create", "error"]);
    expect(codesOf(inFile[2])).toEqual(["target.loop"]);
    const withStore = plan([["/a", "/b"]], { index: store({ "/b": "/a" }) });
    expect(codesOf(withStore[0])).toEqual(["target.loop"]);
  });

  it("replaces a manual redirect of the same address, or keeps it by the option, and leaves an equal one unchanged", () => {
    const index = store({ "/a": "/category/shoes", "/same": "/p/lamp" });
    const pairs: [string, string][] = [["/a", "/p/lamp"], ["/same", "/p/lamp"]];
    const replaced = plan(pairs, { index });
    expect(replaced.map((p) => [p.action, p.outcome])).toEqual([["replace", "updated"], ["unchanged", "unchanged"]]);
    expect(codesOf(replaced[0])).toEqual(["exists.update"]);
    expect(codesOf(replaced[1])).toEqual(["exists.same"]);
    const kept = plan(pairs, { index, options: { existing: "skip" } });
    expect(kept.map((p) => [p.action, p.outcome])).toEqual([["skip", "skipped"], ["unchanged", "unchanged"]]);
    expect(codesOf(kept[0])).toEqual(["exists.skipped"]);
    expect(writesOf(kept)).toEqual([]);
  });

  it("replaces an automatic redirect from the address, and says so; with the option to keep, it is skipped", () => {
    const index = store({}, { "/p/old-cup": "/p/new-cup" });
    const [p] = plan([["/p/old-cup", "/category/shoes"]], { index });
    expect(p).toMatchObject({ action: "create", replacesAutomatic: true });
    expect(codesOf(p)).toEqual(["exists.replaced_automatic"]);
    const [kept] = plan([["/p/old-cup", "/category/shoes"]], { index, options: { existing: "skip" } });
    expect(kept).toMatchObject({ action: "skip", replacesAutomatic: false });
    expect(codesOf(kept)).toEqual(["exists.skipped"]);
  });

  it("refuses a line over the limit, and counts the lines it would create against it", () => {
    const result = plan([["/a", "/p/lamp"], ["/b", "/p/lamp"], ["/c", "/p/lamp"]], { manualCount: 3, limit: 5 });
    expect(result.map((p) => p.action)).toEqual(["create", "create", "error"]);
    expect(codesOf(result[2])).toEqual(["limit.reached"]);
    // A replacement is not a new redirect.
    const replace = plan([["/a", "/category/shoes"]], { manualCount: 5, limit: 5, index: store({ "/a": "/p/lamp" }) });
    expect(replace[0].action).toBe("replace");
  });

  it("covers every code a line can have (the file's own codes are the reader's)", () => {
    const seen = new Set<FindingCode>();
    const files: [string, string][][] = [
      [["", "/x"], ["/a b", "/x"], ["https://evil.example/a", "/x"], ["/no/a", "/x"], ["/checkout", "/x"], ["/p/lamp", "/x"], ["/", "/x"], ["/q?1", "/category/shoes"]],
      [["/a", ""], ["/a", "javascript:1"], ["/a", "https://evil.example"], ["/a", "/a"], ["/a", "/no/p/lamp"], ["/a", "/none"], ["/d", "/p/lamp"], ["/d", "/p/lamp"]],
      [["/x", "/y"], ["/y", "/x"], ["/b", "/y"]],
      [["/y", "/p/lamp"], ["/b", "/y"]],
    ];
    for (const file of files) for (const p of plan(file, { index: store({ "/same": "/p/lamp", "/up": "/p/lamp" }, { "/p/old": "/p/lamp" }) })) p.findings.forEach((f) => seen.add(f.code));
    for (const p of plan([["/same", "/p/lamp"], ["/up", "/category/shoes"], ["/p/old", "/category/shoes"]], { index: store({ "/same": "/p/lamp", "/up": "/p/lamp" }, { "/p/old": "/p/lamp" }) })) p.findings.forEach((f) => seen.add(f.code));
    for (const p of plan([["/up", "/category/shoes"]], { index: store({ "/up": "/p/lamp" }), options: { existing: "skip" } })) p.findings.forEach((f) => seen.add(f.code));
    for (const p of plan([["/zz", "/p/lamp"]], { manualCount: 2, limit: 2 })) p.findings.forEach((f) => seen.add(f.code));
    const lineCodes = FINDING_CODES.filter((c) => /^(source|target|duplicate|exists|limit)\./.test(c));
    expect(lineCodes.filter((c) => !seen.has(c))).toEqual([]);
  });

  it("counts what a check tells the member, and gives the items of the job", () => {
    const result = planRedirectImport(
      lines(["/a", "/category/shoes"], ["/up", "/p/lamp"], ["/same", "/p/lamp"], ["/keep", "/p/lamp"], ["", "/x"], ["/b", "/category/shoes"]),
      env({ index: store({ "/up": "/category/shoes", "/same": "/p/lamp", "/keep": "/category/shoes" }), options: { existing: "skip" } }),
    );
    expect(result.dry).toEqual({ toCreate: 2, toReplace: 0, unchanged: 1, skipped: 2, withErrors: 1 });
    const replacing = planRedirectImport(lines(["/up", "/p/lamp"]), env({ index: store({ "/up": "/category/shoes" }) }));
    expect(replacing.dry).toEqual({ toCreate: 0, toReplace: 1, unchanged: 0, skipped: 0, withErrors: 0 });
    expect(countPlans(result.lines)).toEqual(result.dry);
    const first = result.lines[0];
    expect(redirectItemOf(first, true)).toEqual({ kind: "redirect", ref: "/a", rows: [2], outcome: "checked", messages: [], changes: { will: "created" } });
    expect(redirectItemOf(first, false)).toMatchObject({ outcome: "created", changes: {} });
    expect(redirectItemOf(result.lines[4], false)).toMatchObject({ ref: null, outcome: "failed", rows: [6] });
    expect(redirectItemOf({ ...first, replacesAutomatic: true }, false).changes).toEqual({ replacesAutomatic: true });
  });

  it("does not change the index it is given", () => {
    const index = store({ "/b": "/p/lamp" });
    const before = JSON.stringify([...index.manual]);
    plan([["/a", "/b"], ["/c", "/a"]], { index });
    expect(JSON.stringify([...index.manual])).toBe(before);
    expect(index.automatic.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Properties, over seeded random files
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const POOL = ["/a", "/b", "/c", "/d", "/e", "/f", "/p/lamp", "/category/shoes", "/cart", "/x?q=1", "/A/", "/no/p/lamp", "/p/old", "", "https://evil.example/x"];
const randomFile = (next: () => number, size: number): RedirectLine[] =>
  Array.from({ length: size }, (_, i) => ({ row: i + 2, from: POOL[Math.floor(next() * POOL.length)], to: POOL[Math.floor(next() * POOL.length)] }));

/** What an apply does to the store: the lines that write put their target in, and an automatic redirect they replace goes. */
function apply(index: RedirectIndex, plans: readonly LinePlan[]): RedirectIndex {
  const manual = new Map(index.manual);
  const automatic = new Map(index.automatic);
  for (const w of writesOf(plans)) {
    if (w.replacesAutomatic) automatic.delete(w.source);
    manual.set(w.source, w.target);
  }
  return { manual, automatic };
}
const base = (): RedirectIndex => store({ "/c": "/category/shoes" }, { "/p/old": "/p/lamp" });
const optionsOf = (n: number): RedirectImportOptions => ({ existing: n % 2 === 0 ? "replace" : "skip" });

describe("properties of a plan", () => {
  it("applying a plan and planning the same file again finds the lines unchanged, in two passes at most (a chain through a line that is replaced later in the file settles in the second)", () => {
    const next = rng(2026);
    for (let i = 0; i < 400; i += 1) {
      const file = randomFile(next, 1 + Math.floor(next() * 9));
      const options = optionsOf(i);
      const pass = (index: RedirectIndex) => planRedirectImport(file, env({ index, manualCount: index.manual.size, options })).lines;
      const first = pass(base());
      const afterFirst = apply(base(), first);
      const second = pass(afterFirst);
      const third = pass(apply(afterFirst, second));
      first.forEach((was, k) => {
        const written = was.action === "create" || was.action === "replace" || was.action === "unchanged";
        const seen = [i, k, file[k], was.action, second[k].action, third[k].action];
        if (written) {
          expect(["unchanged", "replace"], JSON.stringify(seen)).toContain(second[k].action);
          expect(third[k].action, JSON.stringify(seen)).toBe("unchanged");
        } else if (was.action === "skip") {
          expect(["skip", "unchanged"], JSON.stringify(seen)).toContain(second[k].action);
        } else {
          expect(second[k].action, JSON.stringify(seen)).toBe("error");
          expect(third[k].action, JSON.stringify(seen)).toBe("error");
        }
      });
    }
  });

  it("is settled at once when no line's target is another line's source", () => {
    const next = rng(8);
    const targets = ["/p/lamp", "/category/shoes", "/cart", "/p/new-cup"];
    for (let i = 0; i < 100; i += 1) {
      const file: RedirectLine[] = ["/a", "/b", "/c", "/d", "/e"].slice(0, 1 + Math.floor(next() * 5)).map((from, k) => ({ row: k + 2, from, to: targets[Math.floor(next() * targets.length)] }));
      const first = planRedirectImport(file, env({ index: base() }));
      const again = planRedirectImport(file, env({ index: apply(base(), first.lines), manualCount: 5 }));
      again.lines.forEach((p) => expect(p.action).toBe("unchanged"));
    }
  });

  it("leaves a store with no loop, no chain longer than the limit and no redirect to itself", () => {
    const next = rng(77);
    for (let i = 0; i < 400; i += 1) {
      const file = randomFile(next, 2 + Math.floor(next() * 10));
      const index = apply(base(), planRedirectImport(file, env({ index: base(), manualCount: 1, options: optionsOf(i) })).lines);
      for (const [source, target] of index.manual) {
        const chain = followChain(source, index, { isLive: (p) => live.has(p) });
        expect([i, source, chain.status === "loop" || chain.status === "too_long"]).toEqual([i, source, false]);
        expect([i, source, target.split(/[?#]/)[0] === source]).toEqual([i, source, false]);
        expect(source.startsWith("/") && !source.endsWith("/") && !/[A-Z]/.test(source)).toBe(true);
      }
    }
  });

  it("never writes a line it refused, and writes exactly the lines it creates or replaces", () => {
    const next = rng(5);
    for (let i = 0; i < 300; i += 1) {
      const file = randomFile(next, 1 + Math.floor(next() * 8));
      const result = planRedirectImport(file, env({ index: base(), manualCount: 1, options: optionsOf(i) }));
      expect(writesOf(result.lines)).toHaveLength(result.dry.toCreate + result.dry.toReplace);
      for (const p of result.lines) {
        if (p.action === "error") expect(p.findings.some((f) => f.severity === "error")).toBe(true);
        else expect(p.findings.some((f) => f.severity === "error")).toBe(false);
      }
    }
  });

  it("the first line of an address is the one written, whatever the lines after it say", () => {
    const next = rng(9);
    for (let i = 0; i < 200; i += 1) {
      const file = randomFile(next, 2 + Math.floor(next() * 8));
      const dup = duplicateRows(file, ctx);
      const result = planRedirectImport(file, env({ index: base(), manualCount: 1 }));
      for (const row of dup) expect(result.lines.find((p) => p.row === row)?.action).toBe("error");
    }
  });

  it("order changes only which line is refused when lines have different addresses and nobody redirects to a source", () => {
    const next = rng(31);
    const sources = ["/a", "/b", "/c", "/d", "/e"];
    const targets = ["/p/lamp", "/category/shoes", "/cart", "/p/new-cup"];
    for (let i = 0; i < 200; i += 1) {
      const file: RedirectLine[] = sources.slice(0, 2 + Math.floor(next() * 4)).map((from, k) => ({ row: k + 2, from, to: targets[Math.floor(next() * targets.length)] }));
      const shuffled = [...file].sort(() => next() - 0.5);
      const written = (ls: RedirectLine[]) => new Map(writesOf(planRedirectImport(ls, env()).lines).map((w) => [w.source, w.target]));
      expect([...written(shuffled)].sort()).toEqual([...written(file)].sort());
    }
  });

  it("a chunk planned against the store as it is then gives the same end state as the whole file at once", () => {
    const next = rng(4242);
    for (let i = 0; i < 200; i += 1) {
      const file = randomFile(next, 2 + Math.floor(next() * 12));
      const options = optionsOf(i);
      const whole = apply(base(), planRedirectImport(file, env({ index: base(), manualCount: 1, options })).lines);
      let index = base();
      const duplicates = duplicateRows(file, ctx);
      for (let at = 0; at < file.length; at += 3) {
        const chunk = file.slice(at, at + 3);
        index = apply(index, planRedirectLines(chunk, env({ index, manualCount: index.manual.size, options, duplicates })));
      }
      expect([i, [...index.manual].sort()]).toEqual([i, [...whole.manual].sort()]);
      expect([...index.automatic].sort()).toEqual([...whole.automatic].sort());
    }
  });
});
