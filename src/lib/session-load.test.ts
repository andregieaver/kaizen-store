import { describe, expect, it } from "vitest";

import { readTranscript, sessionFile, summarise } from "../../scripts/session-load.mjs";

/** scripts/session-load.mjs (bloat review step 1.24): what a session loaded and read, from a transcript built here, never a real one. */

const REPO = "/work/repo";
const SESSION = "11111111-aaaa-bbbb-cccc-222222222222";
const COMMAND = "sed -n 1,20p docs/performance.md # secret-command-text";
const PATTERN = "secret-grep-pattern";

const user = (toolUseId: string, toolUseResult: unknown, text = "") => ({
  type: "user",
  sessionId: SESSION,
  toolUseResult,
  message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }] },
});
const assistant = (...blocks: unknown[]) => ({ type: "assistant", sessionId: SESSION, message: { content: blocks } });

const lines = [
  JSON.stringify({ type: "attachment", sessionId: SESSION, attachment: { type: "instructions", files: [{ path: `${REPO}/CLAUDE.md`, content: "x".repeat(1000) }] } }),
  JSON.stringify({ type: "attachment", sessionId: SESSION, attachment: { type: "instructions", files: [{ path: `${REPO}/CLAUDE.md`, content: "x".repeat(1000) }] } }),
  "not json at all",
  JSON.stringify(assistant({ type: "tool_use", id: "r1", name: "Read", input: { file_path: `${REPO}/docs/rules/storefront.md` } })),
  JSON.stringify(user("r1", { type: "text", file: { filePath: `${REPO}/docs/rules/storefront.md`, content: "y".repeat(500) } })),
  JSON.stringify(assistant({ type: "tool_use", id: "b1", name: "Bash", input: { command: COMMAND } })),
  JSON.stringify(user("b1", { stdout: "z".repeat(300), stderr: "" })),
  JSON.stringify(assistant({ type: "tool_use", id: "g1", name: "Grep", input: { pattern: PATTERN, path: `${REPO}/docs` } })),
  JSON.stringify(user("g1", { content: `a\n${"[Omitted long matching line]"}\nb\n${"[Omitted long matching line]"}` })),
  JSON.stringify(assistant({ type: "tool_use", id: "e1", name: "Edit", input: { file_path: `${REPO}/src/x.ts` } })),
  JSON.stringify(user("e1", { filePath: `${REPO}/src/x.ts` }, "edited")),
  JSON.stringify(assistant({ type: "tool_use", id: "r2", name: "Read", input: { file_path: "/etc/elsewhere.md" } })),
  JSON.stringify(user("r2", { type: "text", file: { filePath: "/etc/elsewhere.md", content: "w".repeat(700) } })),
];

describe("session-load: readTranscript", () => {
  const got = readTranscript(lines, { roots: [REPO] });

  it("counts what was always loaded once, and again with each reload", () => {
    expect(got.totals.alwaysLoadedBytes).toBe(1000);
    expect(got.totals.alwaysLoadedBytesWithReloads).toBe(2000);
    expect(got.alwaysLoaded).toEqual([{ path: "CLAUDE.md", bytes: 1000, times: 2 }]);
  });

  it("counts docs read with Read and through the shell", () => {
    expect(got.totals.rulesAndDocsReadBytes).toBe(800);
    expect(got.read.map((e: { path: string; via: string }) => `${e.path}:${e.via}`).sort()).toEqual(["docs/performance.md:shell", "docs/rules/storefront.md:Read"]);
  });

  it("counts omitted long lines, and a change to code", () => {
    expect(got.totals.omittedLongLines).toBe(2);
    expect(got.omitted).toEqual([{ tool: "Grep", path: "docs", count: 2 }]);
    expect(got.codeChange).toBe(true);
  });

  it("keeps a file outside the repo only as bytes", () => {
    expect(got.totals.outsideRepoBytes).toBe(700);
    expect(JSON.stringify(got)).not.toContain("elsewhere");
    expect(got.totals.sourceReadBytes).toBe(0);
  });

  it("writes no session id, command or search pattern", () => {
    const file = sessionFile(got, { date: "2026-11-17", step: "1.24", phase: "before", subagents: 0 });
    const text = JSON.stringify(file);
    expect(file.session).toMatch(/^[0-9a-f]{8}$/);
    for (const secret of [SESSION, "secret-command-text", COMMAND, PATTERN]) expect(text).not.toContain(secret);
    expect(Object.keys(file)).toEqual(["date", "session", "step", "phase", "subagents", "codeChange", "alwaysLoaded", "read", "omitted", "totals"]);
  });

  it("reads a result that has no toolUseResult from the tool_result block, as a subagent's transcript has", () => {
    const sub = [
      JSON.stringify(assistant({ type: "tool_use", id: "r3", name: "Read", input: { file_path: `${REPO}/docs/platform.md` } })),
      JSON.stringify(user("r3", null, "q".repeat(250))),
    ];
    expect(readTranscript(sub, { roots: [REPO] }).totals.rulesAndDocsReadBytes).toBe(250);
  });

  it("says no code change for a session that edits only docs", () => {
    const docsOnly = [JSON.stringify(assistant({ type: "tool_use", id: "e2", name: "Write", input: { file_path: `${REPO}/docs/x.md` } }))];
    expect(readTranscript(docsOnly, { roots: [REPO] }).codeChange).toBe(false);
  });
});

describe("session-load: summarise", () => {
  const file = (total: number, codeChange: boolean, read: Array<{ path: string; bytes: number }> = []) => ({
    phase: "before",
    codeChange,
    read: read.map((r) => ({ ...r, reads: 1, via: "Read" })),
    totals: { alwaysLoadedBytes: total, rulesAndDocsReadBytes: 0, omittedLongLines: 1 },
  });

  it("takes the median over code-change sessions only", () => {
    const got = summarise([file(10_000, true), file(20_000, true), file(30_000, true), file(500_000, false)]);
    expect(got.groups.before.loadMedian).toBe(20_000);
    expect(got.groups.before.codeChange).toBe(3);
    expect(got.lines[0]).toContain("4 of 20");
    expect(got.lines[0]).toContain("20,000");
  });

  it("says WHOLE FILE READ for a rule file read at 80% or more of its size", () => {
    const rule = "docs/rules/storefront.md";
    const got = summarise([file(1, true, [{ path: rule, bytes: 90_000 }])], { [rule]: 100_000 });
    expect(got.lines.join("\n")).toContain("WHOLE FILE READ");
    const small = summarise([file(1, true, [{ path: rule, bytes: 10_000 }])], { [rule]: 100_000 });
    expect(small.lines.join("\n")).not.toContain("WHOLE FILE READ");
  });
});
