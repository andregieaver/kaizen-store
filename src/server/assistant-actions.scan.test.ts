import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The AI manager's two action files load its engine (`@/server/owner-assistant`) inside each action, after the permission check, so
 * the engine is not part of every admin page's server side (bloat review step 0.5). Step 1.8's route-load.graph.test.ts replaces
 * this with a walk of what the admin layouts reach.
 */
const STORE = "src/app/admin/(gated)/[store]/assistant/actions.ts";
const PLATFORM = "src/app/admin/(gated)/platform/assistant/actions.ts";
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

const ENGINE_ACTIONS = {
  [STORE]: ["startAssistantAction", "loadConversationAction", "decideApprovalAction", "deleteConversationAction", "rateAnswerAction"],
  [PLATFORM]: ["startPlatformAssistantAction", "loadPlatformConversationAction", "decidePlatformApprovalAction", "deletePlatformConversationAction", "ratePlatformAnswerAction"],
};
const OTHER_ACTIONS = {
  [STORE]: ["assistantHearAction", "saveSkillAction", "deleteSkillAction"],
  [PLATFORM]: ["platformHearAction", "savePlatformSkillAction", "deletePlatformSkillAction"],
};
const GUARD = { [STORE]: "requireOwner(", [PLATFORM]: "principal()" };

/** Whether the function's first `await` is the permission check (`guard`) and the engine is awaited after it. */
function firstAwaitOk(fileText: string, fnName: string, guard: string): boolean {
  const start = fileText.indexOf(`export async function ${fnName}(`);
  if (start < 0) return false;
  const rest = fileText.slice(start);
  const next = rest.slice(1).search(/^export /m);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  const first = body.indexOf("await ");
  if (first < 0 || !body.slice(first + "await ".length).startsWith(guard)) return false;
  const engine = body.indexOf("await assistant()");
  return engine > first;
}

describe.each([STORE, PLATFORM])("%s", (file) => {
  const text = read(file);

  it("imports the engine as a type only", () => {
    const values = [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s*"(@\/server\/owner-assistant|@\/server\/owner-tools|@\/lib\/owner-tools)"/gm)];
    expect(values.map((m) => m[1])).toEqual([]);
  });

  it("loads the engine with import() and keeps the loader to itself", () => {
    expect(text).toContain('import("@/server/owner-assistant")');
    expect(text).not.toContain("export const assistant");
  });

  it("exports its eight actions and nothing else", () => {
    const names = [...text.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).sort();
    expect(names).toEqual([...ENGINE_ACTIONS[file as keyof typeof ENGINE_ACTIONS], ...OTHER_ACTIONS[file as keyof typeof OTHER_ACTIONS]].sort());
    const exports = [...text.matchAll(/^export .*$/gm)].map((m) => m[0]).filter((line) => !line.startsWith("export async function "));
    expect(exports).toEqual([]);
  });

  it.each(ENGINE_ACTIONS[file as keyof typeof ENGINE_ACTIONS])("%s checks the permission before it loads the engine", (name) => {
    expect(firstAwaitOk(text, name, GUARD[file as keyof typeof GUARD])).toBe(true);
  });
});

describe("the follow-ups", () => {
  it("do not import the owner tools to reach their error class", () => {
    expect(read("src/server/follow-ups.ts")).not.toMatch(/from "\.\/owner-tools"/);
  });
});

describe("firstAwaitOk", () => {
  it("is false when the engine is loaded before the permission check, and true the other way round", () => {
    const wrong = "export async function x(s: string) {\n const { rateAnswer } = await assistant();\n const member = await requireOwner(s);\n}";
    const right = "export async function x(s: string) {\n const member = await requireOwner(s);\n const { rateAnswer } = await assistant();\n}";
    expect(firstAwaitOk(wrong, "x", "requireOwner(")).toBe(false);
    expect(firstAwaitOk(right, "x", "requireOwner(")).toBe(true);
  });
});
