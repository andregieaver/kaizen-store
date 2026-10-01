import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS, skillsFor } from "./assistant-skills";
import { MANAGER_TOOLS_BY_NAME, PLATFORM_TOOLS_BY_NAME, TOOL_WORDS } from "./manager-tools";
import { OWNER_TOOLS_BY_NAME, readToolInput, toolDefinition } from "./owner-tools";
import { adviceFor } from "./platform-experiments";

const read = (name: string, raw: unknown) => readToolInput(PLATFORM_TOOLS_BY_NAME[name], raw);

describe("the platform AI manager's A/B tools (D148, phase 8)", () => {
  it("has two read tools, never gated, and none that start, stop or change a store's test", () => {
    for (const name of ["list_ab_tests", "explain_ab_test"]) {
      expect(PLATFORM_TOOLS_BY_NAME[name], name).toBeDefined();
      expect(PLATFORM_TOOLS_BY_NAME[name].gate, name).toBeUndefined();
      expect(TOOL_WORDS[name], name).toBeTruthy();
      expect(JSON.stringify(toolDefinition(PLATFORM_TOOLS_BY_NAME[name]).parameters), name).not.toContain("$ref");
    }
    // The store's own tools to change a test are the owner's, and are not on the platform.
    for (const name of ["start_experiment", "stop_experiment", "apply_winner", "draft_experiment"]) {
      expect(PLATFORM_TOOLS_BY_NAME[name], name).toBeUndefined();
      expect(OWNER_TOOLS_BY_NAME[name], name).toBeDefined();
    }
    // And the platform's reads are not served to a store's owner or Kaizen Life (they show every store's tests).
    expect(OWNER_TOOLS_BY_NAME.list_ab_tests).toBeUndefined();
    expect(MANAGER_TOOLS_BY_NAME.list_ab_tests).toBeUndefined();
    expect(toolDefinition(PLATFORM_TOOLS_BY_NAME.list_ab_tests).description).toMatch(/cannot start, stop or change/);
  });

  it("reads what list_ab_tests is given, with its defaults and limits", () => {
    expect(read("list_ab_tests", {})).toMatchObject({ ok: true, input: { status: "active", needs_attention: false, limit: 20 } });
    expect(read("list_ab_tests", { store: "fjord-goods", status: "all", needs_attention: true, limit: 50 })).toMatchObject({ ok: true });
    for (const bad of [{ store: "Not A Slug" }, { status: "running" }, { limit: 0 }, { limit: 51 }, { needs_attention: "yes" }]) {
      expect(read("list_ab_tests", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("reads what explain_ab_test is given: an id, not a name or nothing", () => {
    expect(read("explain_ab_test", { test: "11111111-1111-4111-8111-111111111111" })).toMatchObject({ ok: true });
    expect(read("explain_ab_test", { test: "recommendations:11111111-1111-4111-8111-111111111111" })).toMatchObject({ ok: true });
    for (const bad of [{}, { test: "" }, { test: "x" }, { test: "a".repeat(81) }]) expect(read("explain_ab_test", bad), JSON.stringify(bad)).toMatchObject({ ok: false });
  });

  it("has a playbook for the platform, naming only tools the platform has", () => {
    const skill = skillsFor("platform").find((s) => s.id === "ab-tests-platform")!;
    expect(skill).toBeDefined();
    expect(ASSISTANT_SKILLS.filter((s) => s.id === "ab-tests-platform")).toHaveLength(1);
    const text = [skill.when, ...skill.steps].join(" ");
    expect(text).toContain("list_ab_tests");
    expect(text).toContain("explain_ab_test");
    for (const owner of ["start_experiment", "stop_experiment", "apply_winner", "draft_experiment", "suggest_experiments"]) expect(text, owner).not.toContain(owner);
    // It says what the platform cannot do, and what the hourly check does.
    expect(text).toMatch(/cannot start, stop or change/);
    expect(text).toMatch(/hourly check/);
  });
});

describe("adviceFor", () => {
  const base = { guardrail: false, version: null };

  it("says nothing is to be read into a test that cannot speak yet", () => {
    for (const verdict of ["few", "early", null]) expect(adviceFor({ ...base, status: "running", verdict }).join(" "), String(verdict)).toMatch(/Nothing to do|cannot say anything/);
  });

  it("tells the platform to tell the owner, never to press anything", () => {
    for (const verdict of ["broken", "better", "worse", "even"]) {
      const words = adviceFor({ ...base, status: "running", verdict, version: "Version B" }).join(" ");
      expect(words, verdict).toContain("You cannot change a store's test: tell the owner");
      expect(words, verdict).not.toMatch(/apply_winner|stop_experiment|start_experiment/);
    }
    expect(adviceFor({ ...base, status: "running", verdict: "broken" }).join(" ")).toContain("cannot be trusted");
    expect(adviceFor({ ...base, status: "running", verdict: "better", version: "Version B" }).join(" ")).toContain("Version B");
  });

  it("says a guardrail stop was already emailed to the owners, and a decided test needs nothing", () => {
    expect(adviceFor({ ...base, status: "stopped", verdict: null, guardrail: true }).join(" ")).toContain("owners were emailed");
    expect(adviceFor({ ...base, status: "stopped", verdict: null }).join(" ")).toContain("waits for the owner");
    expect(adviceFor({ ...base, status: "applied", verdict: null })).toEqual(["Decided: nothing to do."]);
    expect(adviceFor({ ...base, status: "draft", verdict: null })[0]).toContain("Not started");
  });
});
