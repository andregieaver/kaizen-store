import { describe, expect, it } from "vitest";

import { ASSISTANT_SKILLS } from "./assistant-skills";
import { cleanSkill, isBuiltInKey, skillKey, skillProblem, stepsOf } from "./saved-skills";

describe("saved skills (D350)", () => {
  it("makes a key from the title and never takes a built-in playbook's", () => {
    expect(skillKey("Weekly stock check!")).toBe("weekly-stock-check");
    expect(skillKey("   ")).toBe("skill");
    expect(isBuiltInKey(ASSISTANT_SKILLS[0].id)).toBe(true);
    expect(skillProblem({ title: "x", when: "", steps: "do it" }, ASSISTANT_SKILLS[0].id)).toEqual({ problem: "builtIn" });
  });

  it("cleans the words as they are kept: one line for the name and when, steps without empty lines", () => {
    expect(cleanSkill({ title: "  Stock\n check ", when: " Mondays ", steps: "  Call low_stock \n\n  Draft an email  \n" })).toEqual({
      title: "Stock check",
      when: "Mondays",
      steps: "Call low_stock\nDraft an email",
    });
    expect(stepsOf("a\nb")).toEqual(["a", "b"]);
  });

  it("refuses an empty or too long skill, a customer's details or a secret, and a marketing claim", () => {
    const ok = { title: "Stock check", when: "", steps: "Call low_stock and list what is under 5." };
    expect(skillProblem(ok, "stock-check")).toBeNull();
    expect(skillProblem({ ...ok, title: "" }, "x")).toEqual({ problem: "title" });
    expect(skillProblem({ ...ok, steps: "x".repeat(2001) }, "x")).toEqual({ problem: "steps" });
    expect(skillProblem({ ...ok, when: "x".repeat(301) }, "x")).toEqual({ problem: "when" });
    expect(skillProblem({ ...ok, steps: "Email kari@example.com every week" }, "x")).toEqual({ problem: "private" });
    expect(skillProblem({ ...ok, steps: "Use card 4111111111111111" }, "x")).toEqual({ problem: "private" });
    expect(skillProblem({ ...ok, steps: "The password is hunter2" }, "x")).toEqual({ problem: "private" });
    expect(skillProblem({ ...ok, steps: "Say it is the best price in Norway" }, "x")).toMatchObject({ problem: "claim" });
    // Prices and stock are a store's work: a step may name them.
    expect(skillProblem({ ...ok, steps: "Set the price to 199 kr when stock is under 10" }, "x")).toBeNull();
  });
});
