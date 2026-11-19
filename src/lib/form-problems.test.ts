import { describe, expect, it } from "vitest";
import { z } from "zod";

import { answerOf, formProblems, problemId, refusalOf } from "./form-problems";

describe("problems tied to their fields (PSI ACC-05)", () => {
  it("names each field's first problem and lists every message once", () => {
    const parsed = z
      .object({ email: z.string().email("Enter an email address."), storeName: z.string().trim().min(1, "Name your store."), city: z.string().min(1, "Name your store.") })
      .safeParse({ email: "nope", storeName: "  ", city: "" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(formProblems(parsed.error.issues)).toEqual({
      status: "error",
      messages: ["Enter an email address.", "Name your store."],
      fields: { email: "Enter an email address.", storeName: "Name your store.", city: "Name your store." },
    });
  });

  it("leaves a problem about the whole form unnamed, and gives ids a selector can use", () => {
    expect(formProblems([{ path: [], message: "Something is missing." }]).fields).toEqual({});
    expect(problemId("sign-up-form", "lines.0.name")).toBe("sign-up-form-problem-lines_0_name");
  });
});

describe("what a quiet form makes of its action's answer (code review 1.15, D829)", () => {
  it("shows a refusal in the form's own shape as it is, its fields kept", () => {
    expect(answerOf({ status: "error", messages: ["Write a tag."], fields: { tag: "Write a tag." } })).toEqual({ status: "error", messages: ["Write a tag."], fields: { tag: "Write a tag." } });
    expect(answerOf({ status: "error", messages: ["In use.", 3, ""] })).toEqual({ status: "error", messages: ["In use."] });
  });

  it("reads the other shapes the admin's actions refuse with", () => {
    expect(answerOf({ ok: false, problems: ["In use.", "Try later."] })).toEqual({ status: "error", messages: ["In use. Try later."] });
    expect(answerOf({ ok: false, problem: "Not connected." })).toEqual({ status: "error", messages: ["Not connected."] });
    expect(refusalOf({ ok: false, message: "Gone." })).toBe("Gone.");
  });

  it("takes nothing, a success or anything else as done, so the form says nothing", () => {
    for (const result of [undefined, null, { ok: true }, { status: "ok", messages: ["Saved."] }, "done", { ok: false }]) expect(answerOf(result)).toEqual({ status: "ok", messages: [] });
  });
});
