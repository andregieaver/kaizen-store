import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkPlan, findLoop, planFinished, skippedBehind, stepReady, type PlanContext, type StepInput } from "./autopilot-plans";
import { tool } from "./owner-tools";

/** The autopilot's plan rules (D309, `docs/ai-autopilot.md` 7.2): what `checkPlan()` refuses, and how steps follow one another. */

const tools = {
  create_product: tool("create_product", "Makes a draft.", z.object({ title: z.string().min(1), price: z.string() })),
  publish_page: tool("publish_page", "Publishes.", z.object({ page: z.string() }), "public"),
  list_products: tool("list_products", "Lists.", z.object({})),
};
const ctx: PlanContext = { scope: "store", tools, now: new Date("2026-10-25T12:00:00Z") };
const s = (step: Partial<StepInput> & Pick<StepInput, "key" | "kind">): StepInput => ({ title: `Step ${step.key}`, after: [], ...step });

describe("checkPlan", () => {
  it("accepts every kind with its fields, and keeps the order given", () => {
    const result = checkPlan(
      [
        s({ key: "s1", kind: "tool", tool: "create_product", args: { title: "Mug", price: "199" }, check: { kind: "product", title: "Mug" } }),
        s({ key: "s2", kind: "task", brief: "Write the about page", tools: ["list_products", "publish_page"], after: ["s1"] }),
        s({ key: "s3", kind: "question", question: "Which colour?", options: ["Blue", "Green"], after: ["s2"] }),
        s({ key: "s4", kind: "wait", until: "2026-11-01T09:00:00+01:00", after: ["s3"] }),
      ],
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps.map((p) => p.spec.kind)).toEqual(["tool", "task", "question", "wait"]);
    expect(result.steps[0].check).toEqual({ kind: "product", title: "Mug", active: false });
    expect(result.steps[3].spec).toEqual({ kind: "wait", until: "2026-11-01T08:00:00.000Z" });
  });

  it("refuses a tool the person may not use, or arguments its schema cannot read", () => {
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "refund_order", args: {} })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("no tool refund_order") });
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "create_product", args: { title: "" } })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("could not be read") });
    expect(checkPlan([s({ key: "s1", kind: "task", brief: "x", tools: ["list_products", "decide_approval"] })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("decide_approval") });
  });

  it("refuses repeated keys, a step waiting for one not in the plan or for itself, and a circle", () => {
    expect(checkPlan([s({ key: "s1", kind: "question", question: "?" }), s({ key: "s1", kind: "question", question: "?" })], ctx)).toMatchObject({ ok: false, problem: "Two steps are called s1." });
    expect(checkPlan([s({ key: "s1", kind: "question", question: "?", after: ["s9"] })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("waits for s9") });
    expect(checkPlan([s({ key: "s1", kind: "question", question: "?", after: ["s1"] })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("waits for itself") });
    expect(
      checkPlan([s({ key: "a", kind: "question", question: "?", after: ["b"] }), s({ key: "b", kind: "question", question: "?", after: ["a"] })], ctx),
    ).toMatchObject({ ok: false, problem: expect.stringContaining("circle") });
  });

  it("refuses an empty kind, a wait too far ahead or without an offset, a check on a question, and more than 30 steps", () => {
    expect(checkPlan([s({ key: "s1", kind: "task", tools: ["list_products"] })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("brief") });
    expect(checkPlan([s({ key: "s1", kind: "wait", until: "2027-06-01T09:00:00Z" })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("90 days") });
    expect(checkPlan([s({ key: "s1", kind: "wait", until: "2026-11-01T09:00:00" })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("offset") });
    expect(checkPlan([s({ key: "s1", kind: "question", question: "?", check: { kind: "store_open" } })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("no check") });
    const many = Array.from({ length: 31 }, (_, i) => s({ key: `s${i}`, kind: "question", question: "?" }));
    expect(checkPlan(many, ctx)).toMatchObject({ ok: false, problem: "A plan has at most 30 steps." });
  });

  it("holds Kaizena Flow's own plans to page checks, and a page check to a title or an address", () => {
    const platform = { ...ctx, scope: "platform" as const };
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "list_products", args: {}, check: { kind: "store_open" } })], platform)).toMatchObject({ ok: false });
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "list_products", args: {}, check: { kind: "count", what: "products", at_least: 3 } })], platform)).toMatchObject({ ok: false });
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "list_products", args: {}, check: { kind: "count", what: "pages", at_least: 3 } })], platform).ok).toBe(true);
    expect(checkPlan([s({ key: "s1", kind: "tool", tool: "list_products", args: {}, check: { kind: "page", published: true } })], ctx)).toMatchObject({ ok: false, problem: expect.stringContaining("title or address") });
  });

  it("lets a revision's new steps wait for the steps kept, without repeating their keys", () => {
    expect(checkPlan([s({ key: "s3", kind: "question", question: "?", after: ["s1"] })], ctx, ["s1", "s2"]).ok).toBe(true);
    expect(checkPlan([s({ key: "s2", kind: "question", question: "?" })], ctx, ["s1", "s2"])).toMatchObject({ ok: false, problem: "Two steps are called s2." });
  });
});

describe("following steps", () => {
  it("finds a circle wherever it is", () => {
    expect(findLoop([{ key: "a", after: [] }, { key: "b", after: ["a", "c"] }, { key: "c", after: ["b"] }])).toEqual(["b", "c", "b"]);
    expect(findLoop([{ key: "a", after: [] }, { key: "b", after: ["a"] }])).toBeNull();
  });

  it("runs a step once everything it waits for is done or skipped", () => {
    const status = new Map([["a", "done"], ["b", "skipped"], ["c", "waiting"]] as const);
    expect(stepReady(["a", "b"], status)).toBe(true);
    expect(stepReady(["a", "c"], status)).toBe(false);
  });

  it("skips the steps behind a skipped one, further back too, and leaves the rest", () => {
    expect(
      skippedBehind([
        { key: "a", after: [], status: "skipped" },
        { key: "b", after: ["a"], status: "pending" },
        { key: "c", after: ["b"], status: "pending" },
        { key: "d", after: [], status: "pending" },
      ]),
    ).toEqual(["b", "c"]);
  });

  it("finishes a plan only when no step is left to run", () => {
    expect(planFinished(["done", "skipped", "cancelled"])).toBe(true);
    expect(planFinished(["done", "asking"])).toBe(false);
    expect(planFinished([])).toBe(false);
  });
});
