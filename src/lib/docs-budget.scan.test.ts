import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { baselineFiles, docsCounts, docsFallen, docsProblems, NEVER_SENTENCES, staleNames, TRACKERS, unnamedBaselines } from "../../scripts/lib/docs-count.mjs";
import { staleRuleNames } from "../../scripts/lib/rule-names.mjs";
import baseline from "./docs-budget.baseline.json";

/**
 * CLAUDE.md is loaded by every session, so it is a core with a map of the rule files (bloat review step 2.1, `docs/rules/budgets.md`):
 * its ceiling is written here, not in the baseline, so no script can raise it. Step 1.1 of `docs/audits/bloat-review-2026-11.md` holds
 * the repository's other written numbers in the baseline file.
 */
describe("CLAUDE.md is a core (bloat review step 2.1)", () => {
  it("CLAUDE.md stays a core", () => {
    const { claude } = docsCounts(process.cwd());
    const hint = "CLAUDE.md is the core every session loads: put the text in the rule file of its area (docs/rules), not here.";
    expect(claude.bytes, hint).toBeLessThanOrEqual(15000);
    expect(claude.lines, hint).toBeLessThanOrEqual(200);
  });
});

describe("the rules cite code that exists (bloat review step 0.41)", () => {
  it("the rules cite only functions and components that exist", () => {
    expect(staleRuleNames(process.cwd()), "A rule cites a name the code no longer has: read the code and correct the rule.").toEqual([]);
  });

  it("finds a name the code does not have, and skips folders that are missing", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "names-"));
    try {
      writeFileSync(path.join(tmp, "CLAUDE.md"), "x");
      mkdirSync(path.join(tmp, "docs", "rules", "admin"), { recursive: true });
      writeFileSync(path.join(tmp, "docs", "rules", "storefront.md"), "Drawn by `NoSuchPartView`, see `noSuchHelper()` and `realHelper()`.");
      mkdirSync(path.join(tmp, "src"));
      writeFileSync(path.join(tmp, "src", "x.ts"), "export function realHelper() {}");
      expect(staleRuleNames(tmp)).toEqual(["docs/rules/storefront.md: NoSuchPartView", "docs/rules/storefront.md: noSuchHelper()"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("every budget has a row in the budgets rule (bloat review step 1.1)", () => {
  it("every baseline file under src is named in the budgets rule", () => {
    expect(
      unnamedBaselines(baselineFiles(process.cwd()), readFileSync(path.join(process.cwd(), "docs/rules/budgets.md"), "utf8")),
      "A baseline file has no row in docs/rules/budgets.md: add a row with its test and the command that lowers it.",
    ).toEqual([]);
  });

  it("finds a baseline file the rule does not name", () => {
    expect(
      unnamedBaselines(["src/lib/planted.baseline.json", "src/server/ratchet.baseline.json"], "a table that names src/server/ratchet.baseline.json"),
    ).toEqual(["src/lib/planted.baseline.json"]);
  });
});

describe("the written rules are held to a budget (bloat review step 1.1)", () => {
  const now = docsCounts(process.cwd());

  /** The problems when one field of the counts is changed. */
  const planted = (change: (counts: typeof now) => void): string[] => {
    const copy = structuredClone(now);
    change(copy);
    return docsProblems(copy, baseline as never);
  };

  it("nothing in the written rules rose", () => {
    expect(docsProblems(now, baseline as never)).toEqual([]);
  });

  it("the baseline is as low as the docs", () => {
    expect(docsFallen(now, baseline as never)).toEqual([]);
  });

  it("notices a 600-character prose line in docs/rules", () => {
    expect(planted((c) => void (c.longLines.rules += 1)).join("\n")).toContain("in rules");
  });

  it("notices a new rule of 5,000 bytes", () => {
    expect(planted((c) => void (c.bigRules["docs/rules/storefront.md#Planted"] = 5000)).join("\n")).toContain("Planted");
  });

  it("notices a new decision of 5,000 bytes", () => {
    expect(planted((c) => void (c.bigDecisions.D99999 = 5000)).join("\n")).toContain("D99999");
  });

  it("notices a dated report no ignore file covers", () => {
    expect(planted((c) => void (c.uncovered = ["docs/audits/psi-2099-01-01.md"])).join("\n")).toContain("psi-2099-01-01.md");
  });

  it("notices a new import", () => {
    expect(planted((c) => void (c.imports = ["AGENTS.md", "docs/platform.md"])).join("\n")).toContain("imports a new file");
  });

  it("notices a .claude/rules file without paths", () => {
    expect(planted((c) => void (c.unpathed = [".claude/rules/x.md"])).join("\n")).toContain(".claude/rules/x.md");
  });

  it("notices a never-sentence that is gone", () => {
    expect(planted((c) => void (c.neverMissing = [String(NEVER_SENTENCES[0])])).join("\n")).toContain("stays in CLAUDE.md");
  });

  it("notices a heading list of 10,001 bytes", () => {
    expect(planted((c) => void (c.headingLists["docs/rules/storefront.md"] = 10001)).join("\n")).toContain("split this rule file");
  });

  it("notices a line over 500 characters in CLAUDE.md", () => {
    expect(planted((c) => void (c.longLines.claude = 1)).join("\n")).toContain("CLAUDE.md has 1 line");
  });

  it("notices a decision id that stands twice", () => {
    expect(planted((c) => void (c.duplicateIds = ["D1"])).join("\n")).toContain("D1 stands twice");
  });

  it.each(TRACKERS.map((file, i) => [file, i] as const))("notices a 400-character row in %s", (file, i) => {
    expect(planted((c) => void (c.trackerRows = [`${TRACKERS[i]}:1`])).join("\n")).toContain(`${file}:1`);
  });

  it("notices CLAUDE.md naming the plan on two lines", () => {
    expect(planted((c) => void (c.planLines = 2)).join("\n")).toContain("on 2 lines");
  });

  it("lets CLAUDE.md's index grow by a rule's line, and a decision be a long table row", () => {
    // The index is held by its own rules (step 0.43) and a decision by the 4,000-byte rule: neither fails here.
    expect(planted((c) => void ((c.claude.bytes += 200), (c.claude.lines += 1), (c.loaded += 200)))).toEqual([]);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "docs-count-"));
    try {
      writeFileSync(path.join(tmp, "CLAUDE.md"), "x\n");
      mkdirSync(path.join(tmp, "docs"), { recursive: true });
      writeFileSync(path.join(tmp, "docs", "decisions.md"), `| D1 | **A decision.** ${"word ".repeat(180)}|\n`);
      expect(docsCounts(tmp).longLines.decisions).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("counts a long line in the rules from real text", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "docs-count-"));
    try {
      writeFileSync(path.join(tmp, "CLAUDE.md"), "x\n");
      mkdirSync(path.join(tmp, "docs", "rules"), { recursive: true });
      writeFileSync(path.join(tmp, "docs", "rules", "storefront.md"), `# Rules\n\n## One\n\n${"word ".repeat(120)}\n`);
      expect(docsCounts(tmp).longLines.rules).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds a dated report an ignore file does not cover, and stops finding it once one does", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "docs-count-"));
    try {
      writeFileSync(path.join(tmp, "CLAUDE.md"), "x\n");
      mkdirSync(path.join(tmp, "docs", "audits"), { recursive: true });
      writeFileSync(path.join(tmp, "docs", "audits", "psi-2099-01-01.md"), "# Report\n");
      expect(docsCounts(tmp).uncovered).toHaveLength(1);
      writeFileSync(path.join(tmp, "docs", "audits", ".ignore"), "psi-*.md\n");
      expect(docsCounts(tmp).uncovered).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("the rules cite only code that exists (bloat review step 1.1)", () => {
  it("the rules cite only code that exists", () => {
    expect(docsCounts(process.cwd()).staleNames).toEqual([]);
  });

  it("a rule that cites a path, a component and a function that do not exist fails", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "names-"));
    try {
      writeFileSync(path.join(tmp, "CLAUDE.md"), "x");
      mkdirSync(path.join(tmp, "docs", "rules", "admin"), { recursive: true });
      writeFileSync(
        path.join(tmp, "docs", "rules", "storefront.md"),
        "Drawn by `NoSuchPartView` in `src/components/no-such-part.tsx`, see `noSuchHelper()`.",
      );
      mkdirSync(path.join(tmp, "src"));
      writeFileSync(path.join(tmp, "src", "x.ts"), "export const a = 1;");
      expect(staleNames(tmp)).toEqual([
        "docs/rules/storefront.md: NoSuchPartView",
        "docs/rules/storefront.md: noSuchHelper()",
        "docs/rules/storefront.md: src/components/no-such-part.tsx",
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("a push of Markdown alone runs the docs budget (bloat review step 1.1)", () => {
  const workflow = readFileSync(path.join(process.cwd(), ".github/workflows/docs-budget.yml"), "utf8");
  const ci = readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");

  it("runs the check with node alone: no install, no secret, no deploy", () => {
    expect(workflow).toContain("run: node scripts/docs-ratchet.mjs --check");
    expect(/pnpm install|VERCEL|secrets\.|needs:/.test(workflow)).toBe(false);
  });

  it("watches the rules, the ignore files and the budget's own files", () => {
    for (const watched of ["CLAUDE.md", "docs/**", ".claude/rules/**", "**/.rgignore", "scripts/docs-ratchet.mjs", "src/lib/docs-budget.baseline.json"]) {
      expect(workflow, watched).toContain(`"${watched}"`);
    }
  });

  it("leaves ci.yml's paths and jobs alone: it only names the workflow in a comment", () => {
    expect(ci).toContain("docs-budget.yml");
    expect(ci.split("\n").filter((line) => line.includes("docs-budget") && !line.trim().startsWith("#"))).toEqual([]);
  });
});
