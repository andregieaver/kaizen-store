import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// The replay calls no model: a call would be a harness that asks more than the recording holds.
vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  const refuse = async () => {
    throw new Error("the replay must not call a model");
  };
  return { ...real, chatWithTools: refuse, completeText: refuse };
});

const { recordingProblems } = await import("@/lib/agent-eval");
const { promptVersions, replayAgentEval, toolsVersion } = await import("./agent-eval");

/**
 * The agents' safety eval in CI (wave 11 unit L, D391, PSI AGT-14): the run recorded from the real model on Platform → AI, kept in the
 * repository, played back through the harness as it is now. It fails when a prompt changed since the recording (a new prompt version has
 * not been evaluated), when a case was added or the harness asks the model something it was not asked, and when the recorded model fails
 * a case. To record again: Platform → AI → *Run the agents' eval*, then *Download the recording* of that run into this file.
 */
const FILE = new URL("../data/agent-eval-recording.json", import.meta.url);
const recording = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;

describe("the agents' eval, replayed from its recording (D391)", () => {
  if (!recording) {
    it.todo("record a run on Platform → AI and keep its recording as src/data/agent-eval-recording.json");
    return;
  }

  it("was recorded with the prompts as they are and every case", () => {
    expect(recordingProblems(recording, promptVersions(), undefined, toolsVersion()), "Record the eval again on Platform → AI and keep its recording as src/data/agent-eval-recording.json").toEqual([]);
  });

  it("passes every case, as the recorded model answered", async () => {
    const result = await replayAgentEval(recording);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(result.total);
  });
});
