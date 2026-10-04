import { describe, expect, it } from "vitest";

import { EXPORT_PROBLEMS, exportProblemOf } from "./privacy-admin";

describe("the refused download's fixed sentences", () => {
  it("turns a known code into its sentence", () => {
    expect(exportProblemOf("too_large")).toBe(EXPORT_PROBLEMS.too_large);
    expect(exportProblemOf("not_found")).toBe(EXPORT_PROBLEMS.not_found);
  });

  it("shows nothing for anything else, so text from the address is never printed", () => {
    expect(exportProblemOf("<script>alert(1)</script>")).toBeNull();
    expect(exportProblemOf("constructor")).toBeNull();
    expect(exportProblemOf("toString")).toBeNull();
    expect(exportProblemOf("")).toBeNull();
    expect(exportProblemOf(undefined)).toBeNull();
    expect(exportProblemOf(null)).toBeNull();
  });
});
