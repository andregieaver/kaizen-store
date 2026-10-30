import { describe, expect, it } from "vitest";
import { z } from "zod";

import { formProblems, problemId } from "./form-problems";

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
