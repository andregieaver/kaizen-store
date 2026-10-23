import { describe, expect, it } from "vitest";

import { assistantLanguageLines } from "./assistant-lang";

describe("assistantLanguageLines", () => {
  it("tells the model to answer in Norwegian when the admin is in Norwegian", () => {
    const lines = assistantLanguageLines("nb");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/answer in Norwegian/);
  });

  it("adds nothing for an English admin", () => {
    expect(assistantLanguageLines("en")).toEqual([]);
  });
});
