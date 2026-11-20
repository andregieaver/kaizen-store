import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { IMPORT, SRC, chain, files, read, reach, rel, resolve, typesOnly } from "@/test/import-walk";

/**
 * A catalogue file holds text only (bloat review steps 1.4 and 2.50, `docs/rules/budgets.md`). `src/lib/admin-messages/*.ts` is loaded by
 * every screen that reads an area's words, through its area module (`src/lib/admin-words`); a value import of code in it would bring that code
 * (and what it imports, zod among it) along. So a catalogue file's value imports are other catalogue files and the leaves below only, and the
 * walk from every catalogue file reaches no zod, no file under `src/components` and no file under `src/server`. English that code reads too
 * lives in a leaf (`<thing>-labels.ts`, types only) beside that code, which re-exports it; the catalogue spreads it from the leaf.
 */
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
  "lib/analytics-captions.ts": "Each analytics table's caption, which the CSV registry (ANALYTICS_TABLES) and its file names are built from.",
  "lib/backdrop-words.ts": "The builder's backdrop and layer words (D534), which the fields read in English when no words are handed down.",
  "lib/bulk-admin-labels.ts": "The bulk editor's words, read by bulk-admin.ts's functions as their English as well.",
  "lib/data-admin-labels.ts": "What the import and export pages say, read by the redirect import's pages and data-admin.ts's test as well.",
  "lib/data-job-labels.ts": "A data job's status in words, read by the job's email, the AI manager's job tool and the redirect import's pages as well.",
  "lib/inventory-admin-labels.ts": "The reasons a person gives for a stock change, read by the stock table as well.",
  "lib/inventory-labels.ts": "Stock movements' reasons and the stock policy in words, read by inventory.ts's functions (reasonWord, policyWords) as well.",
  "lib/usage-labels.ts": "What a store is told at a hard limit of its plan and what each measured figure is called, read by the server's refusals (limitRefusal() in English), the usage email and the AI manager's usage tools as well.",
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
  "lib/storefront-api-labels.ts": "What each storefront API route is for, which the routes and the published contract read as well.",
  "lib/store-parts.ts": "Imports nothing but types: each component, piece and note of the store is defined once with its English name and hint, which the builder draws when no words are handed down.",
  "lib/tripletex-labels.ts": "What the Tripletex connection says to an owner, read by tripletex-errors.ts's failureWords() and its tests as well.",
  "lib/order-status.ts": "An order's status and its chip's signal: a label module already (no imports), read by the order table and a subscription's page as well.",
  "lib/bonus-admin-english.ts": "The bonus program's rules, overview and adjustment words in English, read by the AI manager's bonus tools as well.",
  "lib/affiliate-admin-english.ts": "The affiliate program's rules and overview in English, read by the AI manager's referral tools as well.",
  "lib/segment-labels.ts": "How a segment's rules are said in English (describeRules()), read by the AI manager's marketing tools and a broadcast's audience line as well.",
  "lib/campaign-labels.ts": "What a code or a campaign gives in English (describeCampaign()), read by the AI manager's campaign list as well.",
  "lib/support-inbox-text-english.ts": "Why a conversation went to a person, a summary's outcome and the topics' own words in English, read by the AI manager's support tools as well.",
  "lib/support-report-labels.ts": "A support report's units in English, read by support-reports.ts's rateWords() and durationFigureWords() for the AI manager and the platform as well.",
  "lib/store-closure-labels.ts": "What stands in the way of closing a store and what is worth knowing first, read by the closing service and store-closure.ts on shoppers' routes as well.",
  "lib/payment-method-labels.ts": "A payment method's state in English, read by payment-methods.ts (METHOD_STATE_WORDS), which a client card imports, as well.",
  "lib/store-feature-labels.ts": "The store features' settings words (settings.features), read by FEATURE_WORDS_EN for the AI manager and the setup tools as well.",
  "lib/feature-common-labels.ts": "The store features' common words (common.features), read by FEATURE_WORDS_EN, the AI manager, the setup tools and the server's refusals as well; apart, so the common catalogue in the browser carries no settings words.",
  "lib/tax-readiness-labels.ts": "What the VAT features need, read by the AI manager's tax tools (readiness() in English) as well.",
  "lib/turnover-watch-labels.ts": "The threshold watch's sentences, read by the store checkup (watchText() in English) as well.",
  "lib/version-difference-labels.ts": "What a version changes (differences, blockNames) in English, read by the AI manager's A/B test tools (differenceLine()) as well.",
  "lib/heat-labels.ts": "The heatmap parts, bands and the front page's name in English, read by the AI manager's heatmap tools (pageFigures(), hubFigures()) as well.",
  "lib/analytics-note-labels.ts": "The analytics reports' notes in English, which the report servers write, the AI manager and the CSV read and sayIn() matches, as well.",
  "lib/finance-statement-labels.ts": "The finance bridge's lines and notes in English, read by financeStatement() for the morning summary and the CSV export as well.",
  "lib/tax-report-labels.ts": "A tax report's refusals in English, which rateProblemText() matches in tax-report-words.ts (a module the tax views import in the browser) as well.",
};
const isLeaf = (file: string) => rel(file) in ALLOWED_LEAVES;

/** `file -> target` for the value imports of a catalogue file that are neither another catalogue file nor a leaf; `planted` adds specifiers. */
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
      if (target === null) found.add(`${rel(file).replace("lib/admin-messages/", "")} -> ${specifier}`);
      else if (!inFolder(target) && !isLeaf(target)) found.add(`${rel(file).replace("lib/admin-messages/", "")} -> ${rel(target)}`);
    }
  }
  return [...found].sort();
}

/** What the walk from `file` reaches that a catalogue may never reach: zod, a component, a file of src/server. */
function forbidden(file: string, planted?: Map<string, string[]>): string[] {
  return [...reach(file, { stopAtServerOnly: false, planted }).keys()]
    .map(rel)
    .filter((target) => target === "zod" || target.startsWith("components/") || target.startsWith("server/"))
    .map((target) => `${rel(file)} -> ${target}`);
}

/** The value imports of a leaf that are not another leaf; `planted` adds specifiers. */
function leafImports(planted?: Map<string, string[]>): string[] {
  const wrong: string[] = [];
  for (const leaf of Object.keys(ALLOWED_LEAVES)) {
    const file = join(SRC, leaf);
    const specifiers: string[] = [...(planted?.get(file) ?? [])];
    for (const match of read(file).matchAll(IMPORT)) {
      if (match[2] !== undefined && typesOnly(match[1])) continue;
      specifiers.push(match[2] ?? match[3]);
    }
    for (const specifier of specifiers) {
      const target = resolve(file, specifier);
      if (!target || !isLeaf(target)) wrong.push(`${leaf} -> ${target ? rel(target) : specifier}`);
    }
  }
  return wrong;
}

describe("a catalogue file holds text only (bloat review steps 1.4 and 2.50)", () => {
  it("finds the catalogue files", () => {
    const names = CATALOGUES.map(rel);
    expect(names.length).toBeGreaterThan(120);
    expect(names).toContain("lib/admin-messages/notifications.en.ts");
  });

  it("a catalogue file imports only other catalogue files and the allowed leaves", () => {
    expect(
      directImports(),
      "A catalogue file holds text only: import the type, or move the English that code reads too into a <thing>-labels.ts leaf beside that code (types only), which it re-exports, and name the leaf in ALLOWED_LEAVES with its reason.",
    ).toEqual([]);
  });

  it("an allowed leaf imports nothing but types and other leaves", () => {
    expect(leafImports(), "A leaf a catalogue file imports holds text or numbers only: import types, or another leaf.").toEqual([]);
  });

  it("the walk from every catalogue file reaches no zod, no component and no file of src/server", () => {
    expect(CATALOGUES.flatMap((file) => forbidden(file))).toEqual([]);
  });

  it("every allowed leaf exists and is imported by a catalogue file", () => {
    const imported = new Set(CATALOGUES.flatMap((file) => [...reach(file, { stopAtServerOnly: false }).keys()].map(rel)));
    expect(Object.keys(ALLOWED_LEAVES).filter((leaf) => !imported.has(leaf)), "A leaf no catalogue file reaches leaves ALLOWED_LEAVES.").toEqual([]);
  });

  it("would notice: a code import, directly or behind another catalogue file", () => {
    const analytics = join(FOLDER, "analytics.en.ts");
    const nb = join(FOLDER, "notifications.nb.ts");
    expect(directImports(new Map([[analytics, ["../tripletex-settings"]]]))).toContain("analytics.en.ts -> lib/tripletex-settings.ts");
    const behind = new Map([[analytics, ["./notifications.nb"]], [nb, ["../tripletex-settings"]]]);
    expect(forbidden(analytics, behind)).toContain("lib/admin-messages/analytics.en.ts -> zod");
    expect(chain(reach(analytics, { planted: behind, stopAtServerOnly: false }), "zod")).toEqual(["lib/admin-messages/analytics.en.ts", "lib/admin-messages/notifications.nb.ts", "lib/tripletex-settings.ts", "zod"]);
  });

  it("would notice: zod, a component and a server file, and a leaf that imports code", () => {
    const analytics = join(FOLDER, "analytics.en.ts");
    expect(directImports(new Map([[analytics, ["zod"]]]))).toContain("analytics.en.ts -> zod");
    expect(forbidden(analytics, new Map([[analytics, ["@/components/admin/automation/rule-list"]]]))).toContain("lib/admin-messages/analytics.en.ts -> components/admin/automation/rule-list.tsx");
    expect(forbidden(analytics, new Map([[analytics, ["@/server/cart"]]]))).toContain("lib/admin-messages/analytics.en.ts -> server/cart.ts");
    const leaf = join(SRC, "lib/order-list-labels.ts");
    expect(leafImports(new Map([[leaf, ["./order-list"]]]))).toContain("lib/order-list-labels.ts -> lib/order-list.ts");
  });
});
