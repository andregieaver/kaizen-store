import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { IMPORT, SRC, chain, files, read, reach, rel, resolve, typesOnly } from "@/test/import-walk";

import baseline from "./imports.baseline.json";

/**
 * A catalogue file holds text only (bloat review step 1.4, `docs/rules/budgets.md`). `src/lib/admin-messages/*.ts` is loaded by every
 * screen that reads an area's words, and by step 2.50 only by the area modules; a value import of code in it brings that code (and what
 * it imports, zod among it) along. The direct value imports of code that stand today are in `imports.baseline.json` (`already`, as
 * `file -> target`); a new one fails, and the walk (case 3) finds code that arrives through another catalogue file. Rewrite the list
 * with `WRITE_ADMIN_IMPORTS_BASELINE=1 pnpm exec vitest run src/lib/admin-messages/imports.scan.test.ts` when an import has gone (or
 * when growth is accepted on purpose, shown in the diff). Step 2.50 empties it.
 */
const WRITE = process.env.WRITE_ADMIN_IMPORTS_BASELINE === "1";
const FOLDER = join(SRC, "lib/admin-messages");
const CATALOGUES = files(FOLDER).filter((file) => file.slice(FOLDER.length + 1).indexOf("/") === -1);
const inFolder = (file: string) => file.startsWith(FOLDER + "/");

/**
 * The modules outside the folder a catalogue file may import (bloat review step 2.50), each with its reason: a leaf holds English or numbers that
 * code reads too, and imports nothing but types and other leaves here, so the walk from a catalogue ends in it. A new entry is a reviewed change.
 */
const ALLOWED_LEAVES: Record<string, string> = {
  "lib/order-limits.ts": "The order list's numbers that its sentences say out loud (BULK_MAX, VIEWS_MAX, TAGS_PER_ORDER); one reviewed module for a limit.",
  "lib/order-archive-labels.ts": "Why an order cannot be archived, read by its test as well.",
  "lib/order-bulk-labels.ts": "The bulk actions' labels and refusals, read by the AI manager's order tools as well.",
  "lib/order-list-labels.ts": "The order list's columns, filters and cells, read by the filter chips and the AI manager's order tools as well.",
  "lib/order-tags-labels.ts": "Why a tag is refused, read by the admin API as well.",
  "lib/pick-list-labels.ts": "What the pick list leaves out, read by the AI manager's pick list tool as well.",
  "lib/animation-words.ts": "The builder's Animation words (D538): a label module already (no imports), which the fields read in English when no words are handed down.",
  "lib/backdrop-words.ts": "The builder's backdrop and layer words (D534), which the fields read in English when no words are handed down.",
  "lib/bulk-admin-labels.ts": "The bulk editor's words, read by bulk-admin.ts's functions as their English as well.",
  "lib/data-admin-labels.ts": "What the import and export pages say, read by the redirect import's pages and data-admin.ts's test as well.",
  "lib/data-job-labels.ts": "A data job's status in words, read by the job's email, the AI manager's job tool and the redirect import's pages as well.",
  "lib/inventory-admin-labels.ts": "The reasons a person gives for a stock change, read by the stock table as well.",
  "lib/inventory-labels.ts": "Stock movements' reasons and the stock policy in words, read by inventory.ts's functions (reasonWord, policyWords) as well.",
  "lib/vat-treatment-labels.ts": "Why an order has its VAT treatment, read by vat-treatment.ts's reasonStaffText() as well.",
  "lib/booking-bucket-labels.ts": "The booking buckets in English and Norwegian, read by the Fiken and Tripletex settings and the accountant's summary as well.",
  "lib/fiken-labels.ts": "What the Fiken connection says to an owner, read by fiken-errors.ts's fikenFailureWords() and the tests as well.",
  "lib/claims.ts": "Imports nothing: the claim finder and the names of the kinds of claim (CLAIM_LABELS), which a template's problems say and the theme, product and price checks read.",
  "lib/email-template-labels.ts": "The placeholders' names and a template's problems, read by email-template.ts's templateProblems() and the AI manager as well.",
  "lib/integrations.ts": "Imports nothing: the integrations and webhook events are defined once with their English line, read by the integrations pages and the webhooks.",
  "lib/notifications.ts": "Imports nothing: each notification is defined once with its name, when it is sent and why, read by the mailer and the settings.",
  "lib/order-rule-limits.ts": "The automation rules' numbers, which a rule's log says out loud (asksPerDay).",
  "lib/order-rules-labels.ts": "The automation conditions' names, a rule's sentence and its log's outcomes, read by order-rules.ts's describeRule() and the AI manager as well.",
  "lib/staff-alerts-labels.ts": "The staff alerts' names, read by the alerts' emails and the settings' actions as well.",
  "lib/store-parts.ts": "Imports nothing but types: each component, piece and note of the store is defined once with its English name and hint, which the builder draws when no words are handed down.",
  "lib/tripletex-labels.ts": "What the Tripletex connection says to an owner, read by tripletex-errors.ts's failureWords() and its tests as well.",
  "lib/order-status.ts": "An order's status and its chip's signal: a label module already (no imports), read by the order table and a subscription's page as well.",
};
const isLeaf = (file: string) => rel(file) in ALLOWED_LEAVES;

/** `file -> target` for the direct value imports of code, outside the folder or from a package; `planted` adds specifiers to a file. */
function directImports(planted?: Map<string, string[]>): string[] {
  const found = new Set<string>();
  for (const file of CATALOGUES) {
    const specifiers: string[] = [...(planted?.get(file) ?? [])];
    for (const match of read(file).matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      specifiers.push(match[2] ?? match[3]);
    }
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (target && !inFolder(target) && !isLeaf(target)) found.add(`${rel(file).replace("lib/admin-messages/", "")} -> ${rel(target)}`);
    }
  }
  return [...found].sort();
}

/** Modules outside the folder (and packages) that `file` reaches, and the ones its listed imports allow. */
function outside(file: string, planted?: Map<string, string[]>): string[] {
  return [...reach(file, { stopAtServerOnly: false, planted }).keys()].filter((target) => !inFolder(target)).map(rel);
}
function allowed(file: string, already: readonly string[]): Set<string> {
  const name = rel(file).replace("lib/admin-messages/", "");
  const result = new Set<string>(Object.keys(ALLOWED_LEAVES));
  for (const line of already) {
    const [from, to] = line.split(" -> ");
    if (from !== name) continue;
    result.add(to);
    const target = to === "zod" || to.startsWith("@") ? null : join(SRC, to);
    if (target) for (const reached of reach(target, { stopAtServerOnly: false }).keys()) result.add(rel(reached));
  }
  return result;
}
function leaks(planted?: Map<string, string[]>, only?: string): string[] {
  const found: string[] = [];
  for (const file of only ? [only] : CATALOGUES) {
    const ok = allowed(file, baseline.already);
    for (const target of outside(file, planted)) if (!ok.has(target)) found.push(`${rel(file)} -> ${target}`);
  }
  return found.sort();
}

describe.runIf(WRITE)("the baseline writer", () => {
  it("writes the baseline", () => {
    writeFileSync(join(FOLDER, "imports.baseline.json"), JSON.stringify({ already: directImports() }, null, 2) + "\n");
  });
});

describe.skipIf(WRITE)("a catalogue file holds text only (bloat review step 1.4)", () => {
  it("finds the catalogue files", () => {
    const names = CATALOGUES.map(rel);
    expect(names.length).toBeGreaterThan(120);
    expect(names).toContain("lib/admin-messages/notifications.en.ts");
  });

  it("no new value import in a catalogue file", () => {
    const known = new Set(baseline.already);
    expect(
      directImports().filter((line) => !known.has(line)),
      "A catalogue file holds text only: import the type, or keep the label in the module that uses it; if it must stay, add it on purpose with WRITE_ADMIN_IMPORTS_BASELINE=1 pnpm exec vitest run src/lib/admin-messages/imports.scan.test.ts, so it shows in the diff.",
    ).toEqual([]);
  });

  it("the list is as short as the code", () => {
    const now = new Set(directImports());
    expect(
      baseline.already.filter((line) => !now.has(line)),
      "These imports are gone: rewrite the list with WRITE_ADMIN_IMPORTS_BASELINE=1 pnpm exec vitest run src/lib/admin-messages/imports.scan.test.ts",
    ).toEqual([]);
  });

  it("a catalogue file reaches no code but through its listed imports", () => {
    expect(leaks(), "A catalogue file reaches code through another catalogue file: import the type only, or keep the label beside the code that uses it.").toEqual([]);
  });

  it("an allowed leaf imports nothing but types and other leaves (bloat review step 2.50)", () => {
    const wrong: string[] = [];
    for (const leaf of Object.keys(ALLOWED_LEAVES)) {
      const file = join(SRC, leaf);
      for (const match of read(file).matchAll(IMPORT)) {
        if (match[2] !== undefined && typesOnly(match[1])) continue;
        const target = resolve(file, match[2] ?? match[3]);
        if (!target || !isLeaf(target)) wrong.push(`${leaf} -> ${target ? rel(target) : (match[2] ?? match[3])}`);
      }
    }
    expect(wrong, "A leaf a catalogue file imports holds text or numbers only: import types, or another leaf.").toEqual([]);
  });

  it("would notice, by the walk: an import behind another catalogue file", () => {
    const analytics = join(FOLDER, "analytics.en.ts");
    const nb = join(FOLDER, "notifications.nb.ts");
    const behind = leaks(new Map([[analytics, ["./notifications.nb"]], [nb, ["../tripletex-settings"]]]), analytics);
    expect(behind).toContain("lib/admin-messages/analytics.en.ts -> lib/tripletex-settings.ts");
    expect(directImports(new Map([[analytics, ["../tripletex-settings"]]]))).toContain("analytics.en.ts -> lib/tripletex-settings.ts");
  });

  it("would notice: zod is refused outright for a file not on the list", () => {
    const analytics = join(FOLDER, "analytics.en.ts");
    expect(directImports(new Map([[analytics, ["zod"]]]))).toContain("analytics.en.ts -> zod");
    expect(chain(reach(analytics, { planted: new Map([[analytics, ["zod"]]]) }), "zod")).toEqual(["lib/admin-messages/analytics.en.ts", "zod"]);
  });
});
