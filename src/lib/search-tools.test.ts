import { describe, expect, it } from "vitest";

import { OWNER_TOOLS_BY_NAME, approvalSummary } from "./owner-tools";
import { toolKey } from "./owner-tool-permissions";
import { NEVER_AUTOMATIC, TOOL_AREAS } from "./autopilot-autonomy";
import { SEARCH_TOOLS, ruleProblemWords, ruleSentence, synonymProblemWords } from "./search-tools";

/** The AI manager's search tools (wave 6 unit F3, D324, `docs/wave-6-catalogue.md` F.3). */

const named = { productTitle: null, termName: null, termKind: null, target: null, queries: [] as string[], match: "contains" as const };

describe("the search tools", () => {
  it("read freely and change only with the owner's yes, as the Search page's keys", () => {
    expect(OWNER_TOOLS_BY_NAME.search_merchandising.gate).toBeUndefined();
    expect(toolKey("search_merchandising")).toBe("settings:read");
    for (const name of SEARCH_TOOLS.slice(1)) {
      expect(OWNER_TOOLS_BY_NAME[name].gate).toBe("public");
      expect(OWNER_TOOLS_BY_NAME[name].description).toContain("Needs the owner's approval");
      expect(toolKey(name)).toBe("settings:write");
      expect(TOOL_AREAS[name] ?? NEVER_AUTOMATIC.has(name)).toBeTruthy();
    }
  });

  it("say a rule in a sentence written by code", () => {
    expect(ruleSentence({ ...named, action: "pin", productTitle: "Oak table", queries: ["table"] })).toBe('Put "Oak table" first for searches containing "table".');
    expect(ruleSentence({ ...named, action: "boost", termName: "Lamps", termKind: "category" })).toBe('Move the category "Lamps" up in every search.');
    expect(ruleSentence({ ...named, action: "bury", productTitle: null })).toBe("Move something no longer in the store down in every search.");
    expect(ruleSentence({ ...named, action: "redirect", target: "/sale", queries: ["sale"], match: "exact" })).toBe('Send the search "sale" to /sale.');
  });

  it("put the writers' refusals in words, once each", () => {
    expect(synonymProblemWords([{ code: "both_count" }, { code: "both_count" }])).toBe("A two-way group has 2 to 20 words.");
    expect(ruleProblemWords([{ code: "queries_needed" }, { code: "product" }])).toBe("Name at least one search the rule is for. That product is not the store's.");
  });

  it("describe a kept change from its arguments", () => {
    expect(approvalSummary("save_search_synonym", { language: "en", kind: "one_way", words: ["jumper"], means: ["sweater"] })).toBe(
      'Add synonyms in en: searches for "jumper" also find "sweater".',
    );
    expect(approvalSummary("save_search_rule", { action: "pin", product: "oak-table", searches: ["table"], match: "contains" })).toBe(
      'Add a search rule: put the product oak-table first for searches containing "table".',
    );
    expect(approvalSummary("save_search_rule", { action: "redirect", page: "/sale", searches: ["sale"], match: "exact" })).toBe(
      'Add a search rule: send the search "sale" to /sale.',
    );
    expect(approvalSummary("delete_search_merchandising", { rule: "r1" })).toBe("Remove the search rule r1.");
  });

  it("take either a synonym or a rule to remove, never both or neither", () => {
    const input = OWNER_TOOLS_BY_NAME.delete_search_merchandising.input;
    const id = "00000000-0000-4000-8000-000000000001";
    expect(input.safeParse({ rule: id }).success).toBe(true);
    expect(input.safeParse({}).success).toBe(false);
    expect(input.safeParse({ rule: id, synonym: id }).success).toBe(false);
  });
});
