import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { MANAGER_TOOLS, TOOL_WORDS } from "./manager-tools";
import { approvalSummary, OWNER_TOOLS, OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";

const read = (name: string, raw: unknown) => readToolInput(OWNER_TOOLS_BY_NAME[name], raw);
const NAMES = ["list_experiments", "explain_results", "suggest_experiments", "draft_experiment", "start_experiment", "stop_experiment", "apply_winner"];

describe("the A/B test tools in the owner assistant's catalogue (D148)", () => {
  it("lets it read and draft freely, and keeps what changes the site for the owner's yes", () => {
    for (const name of ["list_experiments", "explain_results", "suggest_experiments", "draft_experiment"]) expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
    for (const name of ["start_experiment", "stop_experiment", "apply_winner"]) expect(OWNER_TOOLS_BY_NAME[name].gate, name).toBe("public");
  });

  it("gives each words for the progress line, and JSON Schema without refs", () => {
    for (const name of NAMES) {
      expect(TOOL_WORDS[name], name).toBeTruthy();
      const definition = toolDefinition(OWNER_TOOLS_BY_NAME[name]);
      expect(definition.description.length).toBeGreaterThan(60);
      expect(definition.parameters).toMatchObject({ type: "object" });
      expect(JSON.stringify(definition.parameters)).not.toContain("$ref");
    }
    for (const tool of [...OWNER_TOOLS, ...MANAGER_TOOLS]) expect(TOOL_WORDS[tool.name], tool.name).toBeTruthy();
    for (const name of ["start_experiment", "stop_experiment", "apply_winner"]) expect(OWNER_TOOLS_BY_NAME[name].description, name).toContain("Needs the owner's approval");
    for (const name of ["list_experiments", "explain_results", "suggest_experiments", "draft_experiment"]) expect(OWNER_TOOLS_BY_NAME[name].description, name).not.toContain("Needs the owner's approval");
  });

  it("tells the model it cannot give a verdict or start anything on its own", () => {
    expect(OWNER_TOOLS_BY_NAME.explain_results.description).toMatch(/never give a verdict of your own/);
    expect(OWNER_TOOLS_BY_NAME.suggest_experiments.description).toMatch(/nothing is started without their yes/);
    expect(OWNER_TOOLS_BY_NAME.suggest_experiments.description).toMatch(/never guess/);
    expect(OWNER_TOOLS_BY_NAME.draft_experiment.description).toMatch(/Nothing is shown to visitors until it is started/);
  });

  it("checks what a draft is given: a goal from the list, words within their lengths, at most six changes", () => {
    expect(read("draft_experiment", { target: "om-oss", goal: "cart" })).toMatchObject({ ok: true, input: { changes: [], traffic_percent: 100 } });
    expect(read("draft_experiment", { target: "header", goal: "click", button: "Buy now", changes: [{ block: "b1", text: "Hello" }], traffic_percent: 50 })).toMatchObject({ ok: true });
    for (const bad of [
      { goal: "cart" },
      { target: "om-oss", goal: "sales" },
      { target: "om-oss", goal: "cart", changes: [{ block: "b1", text: "" }] },
      { target: "om-oss", goal: "cart", changes: [{ block: "b1", text: "x".repeat(2001) }] },
      { target: "om-oss", goal: "cart", changes: Array.from({ length: 7 }, (_, i) => ({ block: `b${i}`, text: "x" })) },
      { target: "om-oss", goal: "cart", traffic_percent: 0 },
      { target: "om-oss", goal: "cart", traffic_percent: 101 },
    ]) {
      expect(read("draft_experiment", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("checks what the deciding tools are given", () => {
    expect(read("start_experiment", { experiment: "Heading test" })).toMatchObject({ ok: true });
    expect(read("start_experiment", {})).toMatchObject({ ok: false });
    expect(read("apply_winner", { experiment: "x", version: "b" })).toMatchObject({ ok: true });
    expect(read("apply_winner", { experiment: "x", version: "original" })).toMatchObject({ ok: true });
    expect(read("apply_winner", { experiment: "x", version: "a" })).toMatchObject({ ok: false });
    expect(read("apply_winner", { experiment: "x" })).toMatchObject({ ok: false });
    expect(read("suggest_experiments", { visitors_per_day: 200, current_rate_percent: 3 })).toMatchObject({ ok: true, input: { change_percent: 20 } });
    expect(read("suggest_experiments", { current_rate_percent: 100 })).toMatchObject({ ok: false });
  });

  it("describes a call in words made from its arguments, never the model's", () => {
    expect(approvalSummary("start_experiment", { experiment: "Heading test" })).toBe('Start the A/B test "Heading test": visitors who accepted statistics cookies are shown the versions from their next page view.');
    expect(approvalSummary("stop_experiment", { experiment: "Heading test" })).toContain("everyone sees the original again");
    expect(approvalSummary("apply_winner", { experiment: "Heading test", version: "original" })).toBe('End the A/B test "Heading test" and keep the original.');
    expect(approvalSummary("apply_winner", { experiment: "Heading test", version: "b" })).toContain("make version B the page");
  });

  it("has a playbook that sends the model through suggest, draft, the owner's yes, and the verdict", () => {
    const skill = ASSISTANT_SKILLS.find((s) => s.id === "ab-test");
    expect(skill?.area).toBe("store");
    const steps = skill!.steps.join(" ");
    for (const name of ["suggest_experiments", "draft_experiment", "start_experiment", "list_experiments", "explain_results", "apply_winner"]) expect(steps).toContain(name);
    expect(steps).toMatch(/never call a winner it does not/);
    expect(new Set(ASSISTANT_SKILLS.map((s) => s.id)).size).toBe(ASSISTANT_SKILLS.length);
  });
});
