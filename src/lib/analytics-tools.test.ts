import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, PLATFORM_TOOLS, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

const NAMES = ["analytics_overview", "explain_change", "analytics_alerts"] as const;

describe("the analytics tools in the owner assistant's catalogue (D152)", () => {
  it("has the three tools, all of them reads: none is gated, so none waits for an approval", () => {
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

  it("gives every tool words for the progress line, and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    // Every tool of the store's and the manager's has words.
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
  });

  it("says what each is for and that the figures are counted in code, never by the model", () => {
    const text = (name: string) => OWNER_TOOLS_BY_NAME[name].description;
    expect(text("analytics_overview")).toMatch(/counted in code/);
    expect(text("analytics_overview")).toMatch(/never add up or compare figures yourself/);
    expect(text("analytics_overview")).toMatch(/without VAT/);
    expect(text("explain_change")).toMatch(/in code and never guessed/);
    expect(text("explain_change")).toMatch(/add no cause it did not find/);
    expect(text("analytics_alerts")).toMatch(/in code/);
    expect(text("analytics_alerts")).toMatch(/minimum volume/);
  });

  it("checks the arguments and fills in the defaults", () => {
    const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
    expect(read("analytics_overview", {})).toMatchObject({ ok: true, input: { period: "30d", compare: "previous" } });
    expect(read("analytics_overview", { period: "last_month", compare: "year" })).toMatchObject({ ok: true, input: { period: "last_month", compare: "year" } });
    expect(read("explain_change", { period: "7d" })).toMatchObject({ ok: true, input: { period: "7d", compare: "previous" } });
    expect(read("analytics_alerts", {})).toMatchObject({ ok: true });
    for (const name of ["analytics_overview", "explain_change"]) {
      expect(read(name, { period: "yesterday" })).toMatchObject({ ok: false });
      expect(read(name, { period: "30d", compare: "none" })).toMatchObject({ ok: false });
      expect(read(name, { period: 30 })).toMatchObject({ ok: false });
    }
  });

  it("is in the playbooks that look at how the store is doing", () => {
    const steps = (id: string) => ASSISTANT_SKILLS.find((s) => s.id === id)!.steps.join("\n");
    for (const name of NAMES) expect(steps("grow-sales") + steps("know-your-customers")).toContain(name);
    // The old line said visits are not tracked at all; they are, when the store has switched counting on.
    expect(steps("know-your-customers")).not.toContain("Visits and product views are not tracked");
    expect(steps("know-your-customers")).toContain("visit counting");
  });
});
