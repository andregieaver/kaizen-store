import { describe, expect, it } from "vitest";

import { versionChanges, VERSION_LOG_MAX, withLog, type Versions } from "./challenge-pin";

const seen: Versions = { prompts: { chat: "a1", manager: "b1" }, tools: "t1", model: "openai/gpt-4.1-mini" };

describe("what a challenge store's AI runs on (F5)", () => {
  it("says nothing when nothing changed, and each prompt, the tools and the model that did", () => {
    expect(versionChanges(seen, seen)).toEqual([]);
    expect(versionChanges(seen, { prompts: { chat: "a1", manager: "b2", guide: "g1" }, tools: "t2", model: null })).toEqual([
      "The guide prompt changed from none to g1.",
      "The manager prompt changed from b1 to b2.",
      "The tools changed from t1 to t2.",
      "The text model changed from openai/gpt-4.1-mini to none.",
    ]);
  });

  it("keeps the newest entries of the log", () => {
    const log = withLog([], "2027-01-05T10:00:00Z", ["one", "two"]);
    expect(log).toEqual([
      { at: "2027-01-05T10:00:00Z", what: "one" },
      { at: "2027-01-05T10:00:00Z", what: "two" },
    ]);
    const full = withLog(Array.from({ length: VERSION_LOG_MAX }, (_, i) => ({ at: "x", what: String(i) })), "y", ["new"]);
    expect(full).toHaveLength(VERSION_LOG_MAX);
    expect(full.at(-1)).toEqual({ at: "y", what: "new" });
    expect(full[0].what).toBe("1");
  });
});
