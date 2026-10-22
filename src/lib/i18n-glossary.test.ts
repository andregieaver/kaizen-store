import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GLOSSARY_NB, forbiddenUses, glossaryMarkdown, glossaryProblems } from "./i18n-glossary";

const DOC = path.join(process.cwd(), "docs/i18n/glossary-nb.md");

/** Every hand-written Norwegian catalogue: the shoppers' (`messages/nb*.ts`) and, as they come, the platform's and the admin's. */
function norwegianCatalogues(): string[] {
  const dirs = ["src/lib/messages", "src/lib/admin-messages"].map((d) => path.join(process.cwd(), d)).filter(existsSync);
  return dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /(^|[.-])nb([.-]|\.ts$)/.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => path.join(dir, f)),
  );
}

describe("the Norwegian glossary (D312)", () => {
  it("names a source, a short quote and a date for every term, and no term twice", () => {
    expect(glossaryProblems()).toEqual([]);
  });

  it("finds a forbidden word as a whole word in any case, and not inside another word", () => {
    const entries = [{ key: "withdrawal", area: "consumer" as const, en: "right of withdrawal", nb: "angrerett", definition: "", sources: [], avoid: ["returrett"], status: "researched" as const }];
    expect(forbiddenUses("Du har 14 dagers Returrett.", entries)).toEqual([{ word: "returrett", key: "withdrawal", nb: "angrerett" }]);
    expect(forbiddenUses("returretten", entries)).toEqual([]);
  });

  it("is never contradicted by a Norwegian catalogue", () => {
    const found = norwegianCatalogues().flatMap((file) => forbiddenUses(readFileSync(file, "utf8")).map((use) => `${path.relative(process.cwd(), file)}: "${use.word}" (use "${use.nb}", ${use.key})`));
    expect(found).toEqual([]);
  });

  it("is written out as docs/i18n/glossary-nb.md", () => {
    const written = glossaryMarkdown();
    if (process.env.WRITE_GLOSSARY) writeFileSync(DOC, written);
    expect(existsSync(DOC) ? readFileSync(DOC, "utf8") : "", "run WRITE_GLOSSARY=1 pnpm exec vitest run src/lib/i18n-glossary.test.ts").toBe(written);
  });

  it("has at least one term in each area it covers", () => {
    expect(GLOSSARY_NB.every((e) => e.nb.trim().length > 0 && e.en.trim().length > 0)).toBe(true);
  });
});
