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
 * repository, played back through the harness as it is now. While the recording matches the prompts, the tools and the cases as they are,
 * it fails when the recorded model fails a case or the harness asks the model something it was not asked.
 *
 * A recording that is behind (a prompt, the tools or a case changed since) warns and does not fail (D793, the owner's choice, 19 November
 * 2026): it can only be made again once production runs the change, and a push with a migration deploys only after every check passes, so
 * failing on it held every deploy back for hours whenever sessions pushed a tool change beside a migration. A push without a migration
 * already deployed before this check. The warning is an annotation on the CI run, and Platform → AI shows the eval as not run on the
 * prompts as they are. To record again: Platform → AI → *Run the agents' eval*, then *Download the recording* of that run into this file.
 */
const FILE = new URL("../data/agent-eval-recording.json", import.meta.url);
const recording = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
const behind: string[] = recording ? recordingProblems(recording, promptVersions(), undefined, toolsVersion()) : [];

describe("the agents' eval, replayed from its recording (D391)", () => {
  if (!recording) {
    it.todo("record a run on Platform → AI and keep its recording as src/data/agent-eval-recording.json");
    return;
  }

  if (behind.length > 0) {
    // A GitHub Actions annotation: on the run's summary, without failing it.
    process.stdout.write(`::warning title=The agents' eval is behind (D793)::Record it on Platform → AI once production runs this commit: ${behind.join("; ")}\n`);
    it.skip("passes every case, as the recorded model answered (waits for a recording of the prompts, tools and cases as they are)", () => {});
    return;
  }

  it("passes every case, as the recorded model answered", async () => {
    const result = await replayAgentEval(recording);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(result.total);
  });
});
