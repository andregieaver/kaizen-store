import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { FINDING_CODES, finding, type Finding } from "./data-job";
import { EXAMPLES, FIX_FOR, groupFindings } from "./data-job-help";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { TOOL_PERMISSIONS, mayUseTool } from "./owner-tool-permissions";
import { ADMIN_PAGES } from "./admin-map";

const NAMES = ["list_data_jobs", "explain_import_problems"] as const;

describe("what to do about each finding", () => {
  it("says it for every code the import can make, in a sentence, and for no code that does not exist", () => {
    expect(Object.keys(FIX_FOR).sort()).toEqual([...FINDING_CODES].sort());
    for (const [code, fix] of Object.entries(FIX_FOR)) {
      expect(fix.length, code).toBeGreaterThan(10);
      expect(fix, code).toMatch(/[.]$/);
      expect(fix, code).not.toMatch(/NaN|undefined|\[\[/);
    }
  });

  it("never gives legal advice or promises what the import does not do", () => {
    const all = Object.values(FIX_FOR).join("\n");
    expect(all).not.toMatch(/legal advice|you must by law|tax advice/i);
    // The three things an import never does are not offered as a fix.
    expect(all).not.toMatch(/delete the product|change the web address|import the compare-at/i);
  });
});

describe("groupFindings", () => {
  const f = (code: Parameters<typeof finding>[0], params = {}) => finding(code, params);
  const items = [
    { ref: "boot", messages: [f("sku.in_other_product", { handle: "boot", sku: "B-1" }), f("value.cleared", { handle: "boot", column: "image_alt" })] },
    { ref: "sock", messages: [f("sku.in_other_product", { handle: "sock", sku: "S-1" })] },
    { ref: "sock", messages: [f("sku.in_other_product", { handle: "sock", sku: "S-2" })] },
    { ref: "hat", messages: [f("term.created", { n: 2 }), f("price.unreadable", { handle: "hat", column: "price:NO" })] },
    { ref: null, messages: [f("file.encoding_assumed")] },
  ];

  it("counts findings and products by code, errors first, then warnings, then information, the most first", () => {
    const { groups, totals } = groupFindings(items);
    expect(groups.map((g) => g.code)).toEqual(["sku.in_other_product", "price.unreadable", "file.encoding_assumed", "value.cleared", "term.created"]);
    const sku = groups[0];
    expect(sku).toMatchObject({ severity: "error", findings: 3, products: 2, examples: ["boot", "sock"], what_to_do: FIX_FOR["sku.in_other_product"] });
    expect(totals).toEqual({ error: 4, warning: 2, info: 1 });
  });

  it("names at most five products a group is about, and a finding with no product names none", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ref: `p-${i}`, messages: [f("gtin.invalid", { handle: `p-${i}` })] }));
    expect(groupFindings(many).groups[0]).toMatchObject({ findings: 12, products: 12 });
    expect(groupFindings(many).groups[0].examples).toHaveLength(EXAMPLES);
    expect(groupFindings([{ ref: null, messages: [f("file.empty")] }]).groups[0].examples).toEqual([]);
  });

  it("skips a code this version does not know, and an empty job has no groups", () => {
    const strange = [{ ref: "x", messages: [{ severity: "error", code: "future.code", text: "?" } as unknown as Finding] }];
    expect(groupFindings(strange)).toEqual({ groups: [], totals: { error: 0, warning: 0, info: 0 } });
    expect(groupFindings([])).toEqual({ groups: [], totals: { error: 0, warning: 0, info: 0 } });
  });

  it("keeps the sentence the import wrote, which never quotes a cell", () => {
    const { groups } = groupFindings(items);
    expect(groups.find((g) => g.code === "price.unreadable")?.sentence).toBe(items[3].messages[1].text);
  });
});

describe("the data job tools in the owner assistant's catalogue (D165)", () => {
  it("has both, as reads that no approval waits for", () => {
    for (const name of NAMES) {
      expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
      expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
    }
  });

  it("is an owner's tool, so the store's MCP server serves it, and not a manager's or a platform's", () => {
    const owner = new Set(OWNER_TOOLS.map((t) => t.name));
    for (const name of NAMES) {
      expect(owner.has(name)).toBe(true);
      expect(MANAGER_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
      expect(PLATFORM_TOOLS.some((t) => (t.name as string) === name)).toBe(false);
    }
  });

  it("has no tool that starts, applies, cancels or downloads an import or an export", () => {
    const all = [...OWNER_TOOLS, ...MANAGER_TOOLS, ...PLATFORM_TOOLS].map((t) => t.name as string);
    expect(all.filter((n) => /import|export|bulk_edit|download/.test(n)).sort()).toEqual(["explain_import_problems"]);
  });

  it("gives every tool words and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
  });

  it("says that nothing is changed and that the findings are counted in code", () => {
    const text = (name: string) => OWNER_TOOLS_BY_NAME[name].description;
    expect(text("list_data_jobs")).toMatch(/starts, applies, cancels and downloads nothing/);
    expect(text("list_data_jobs")).toMatch(/never gives a file's contents, a download link or a person's details/);
    expect(text("explain_import_problems")).toMatch(/counted in code/);
    expect(text("explain_import_problems")).toMatch(/never quotes a cell/);
  });

  it("checks the arguments: a kind from the list, a limit in range and an id that is an id", () => {
    const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
    expect(read("list_data_jobs", {})).toMatchObject({ ok: true, input: { limit: 10 } });
    expect(read("list_data_jobs", { kind: "order_export", limit: 5 })).toMatchObject({ ok: true });
    // The redirect jobs (D168) are kinds like the others; a kind that is none of them is refused.
    expect(read("list_data_jobs", { kind: "redirect_import" })).toMatchObject({ ok: true });
    expect(read("list_data_jobs", { kind: "redirect_delete" })).toMatchObject({ ok: false });
    expect(read("list_data_jobs", { limit: 21 })).toMatchObject({ ok: false });
    expect(read("explain_import_problems", {})).toMatchObject({ ok: true });
    expect(read("explain_import_problems", { job_id: "7d9d6a5e-5fda-4f4a-8f0e-0a7d2d4a9c11" })).toMatchObject({ ok: true });
    expect(read("explain_import_problems", { job_id: "'; drop table" })).toMatchObject({ ok: false });
  });

  it("needs the products area's read key, and nothing from another area", () => {
    expect(TOOL_PERMISSIONS.list_data_jobs).toBe("products:read");
    expect(TOOL_PERMISSIONS.explain_import_problems).toBe("products:read");
    expect(mayUseTool({ role: "owner" }, "explain_import_problems")).toBe(true);
    expect(mayUseTool({ role: "admin", permissions: ["products:read"] }, "list_data_jobs")).toBe(true);
    expect(mayUseTool({ role: "admin", permissions: ["products:read"] }, "explain_import_problems")).toBe(true);
    expect(mayUseTool({ role: "admin", permissions: ["orders:write"] }, "list_data_jobs")).toBe(false);
  });
});

describe("the import-products playbook", () => {
  const skill = ASSISTANT_SKILLS.find((s) => s.id === "import-products");

  it("exists once, for stores, and uses the two tools", () => {
    expect(skill?.area).toBe("store");
    expect(ASSISTANT_SKILLS.filter((s) => s.id === "import-products")).toHaveLength(1);
    const text = skill!.steps.join("\n");
    for (const name of NAMES) expect(text).toContain(name);
  });

  it("names only admin pages that exist", () => {
    const ids = new Set(ADMIN_PAGES.map((p) => p.id));
    const text = skill!.steps.join("\n");
    for (const id of ["products.import", "products.import.job", "products.export", "orders.export", "customers.export", "products.bulk"]) {
      expect(text, id).toContain(id);
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("says what an import never does, that the assistant cannot start one, and that Kaizen records no marketing consent", () => {
    const text = skill!.steps.join("\n");
    expect(text).toMatch(/never deletes a product/);
    expect(text).toMatch(/never imports a compare-at price/);
    expect(text).toMatch(/You cannot upload a file, start, apply or cancel an import/);
    expect(text).toMatch(/does not record marketing consent yet/);
  });
});
