import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  AGENT_EVAL_CASES,
  AGENT_PASS_RATE,
  replayReplies,
  scoreAgentCase,
  type AgentEvalCase,
  type AgentRun,
  type EvalRecording,
  type RecordedCase,
  type RecordedReply,
} from "@/lib/agent-eval";
import { storeTools } from "@/lib/chat";
import type { ChatTurn } from "@/lib/legal-writer";
import { MANAGER_TOOLS } from "@/lib/manager-tools";
import { toolKey } from "@/lib/owner-tool-permissions";
import { OWNER_TOOLS, toolDefinition } from "@/lib/owner-tools";
import { LOAD_TOOLS, chooseTools, loadToolsDefinition, readLoadTools, toolArea, type ToolArea } from "@/lib/tool-budget";

import { AiError, chatWithTools, completeText, type AiConnection, type ToolChatMessage, type ToolDefinition } from "./ai";
import type { Account } from "./auth";
import { log } from "./log";
import { fixedManagerPrompt, managerPromptVersion } from "./owner-assistant";
import { chatPromptVersion, fixedChatPrompt, fixedLegalMessages, legalPromptVersion, type PromptVersions } from "./prompt-versions";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Runs the agents' safety eval (`src/lib/agent-eval.ts`, PSI 2026-10-24 AST-09): each case gets its agent's real prompt, drawn with the
 * fixed inputs of `prompt-versions.ts` (so a run is of one prompt version), and its real tool definitions; every tool call is answered from
 * the case's script; nothing is read, written, sent or charged. Against a connection's text model the run is kept in
 * `commerce.ai_eval_runs` with its prompt versions and what the model answered at each step (D391), which CI replays
 * (`agent-eval-replay.int.test.ts`) through the same harness, so a change to a prompt, a tool or the scoring is checked on every push.
 */

/** Each agent's prompt version (D391): what every eval run and recording is of. */
export function promptVersions(): PromptVersions {
  return { chat: chatPromptVersion(), manager: managerPromptVersion(), legal: legalPromptVersion() };
}

/** The tools that change something: the gated owner tools. */
const GATED = new Set<string>(OWNER_TOOLS.filter((t) => t.gate).map((t) => t.name));
/** Rounds of tool calls a case may take, as the manager's own turns do at most (`MAX_STEPS` there is ten; the cases need far fewer). */
const STEPS = 5;
const AT_ONCE = 3;

export type AgentEvalResult = {
  model: string;
  passed: number;
  total: number;
  ok: boolean;
  ms: number;
  failures: { id: string; problems: string[]; answer: string }[];
};

/** What a case is played against: the live model, which records each answer, or a recording given back. */
type EvalModel = {
  step(messages: ToolChatMessage[], tools: ToolDefinition[]): Promise<RecordedReply>;
  write(messages: ChatTurn[]): Promise<string>;
};

function liveModel(connection: AiConnection, replies: RecordedReply[]): EvalModel {
  return {
    async step(messages, tools) {
      const reply = await chatWithTools(connection, messages, tools, { maxTokens: 600, timeoutMs: 45_000 });
      const kept: RecordedReply = { content: reply.content, toolCalls: reply.toolCalls.map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) };
      replies.push(kept);
      return kept;
    },
    async write(messages) {
      const answer = await completeText(connection, messages, { maxTokens: 4000, timeoutMs: 120_000, temperature: 0.2 });
      replies.push({ content: answer.text, toolCalls: [] });
      return answer.text;
    },
  };
}

function recordedModel(recorded: RecordedCase): EvalModel {
  const replies = replayReplies(recorded);
  return {
    step: async (_messages, tools) => replies.next(tools.map((t) => t.name)),
    write: async () => replies.next([]).content ?? "",
  };
}

/** What a scripted tool answers: the case's, a gated tool's "kept for approval" as the manager's own turns say, or nothing found. */
function scripted(testCase: AgentEvalCase, name: string): unknown {
  if (name in testCase.script) return testCase.script[name];
  if (testCase.agent === "manager" && GATED.has(name)) return { kept: "Kept for the owner's approval; it runs only when they say yes." };
  return { found: [], note: "Nothing found." };
}

const OWNER_AREAS = OWNER_TOOLS.map((t) => ({ name: t.name, area: toolArea(t.name, toolKey(t.name)) }));

/**
 * The manager's tools for a case as a real turn sends them (D333, at most `TOOLS_PER_TURN`): the areas of the tools the case scripts,
 * forbids or requires are loaded, as the page the owner is on or a `load_tools` call would, so the tools a case tests are offered.
 */
function managerTools(testCase: AgentEvalCase, wanted: ToolArea[]): ToolDefinition[] {
  const named = new Set([...Object.keys(testCase.script), ...(testCase.expect.forbiddenTools ?? []), ...(testCase.expect.requiredTools ?? [])]);
  const areas = [...wanted, ...OWNER_AREAS.filter((t) => named.has(t.name)).map((t) => t.area)];
  const choice = chooseTools(OWNER_AREAS, MANAGER_TOOLS.length + 1, { used: [...named], wanted: [...new Set(areas)] });
  const chosen = new Set(choice.names);
  const load = loadToolsDefinition(choice.heldBack);
  return [...OWNER_TOOLS.filter((t) => chosen.has(t.name)), ...MANAGER_TOOLS].map(toolDefinition).concat(load ? [load] : []);
}

/** One case through its agent's prompt and tools, against the model given. */
async function runCase(model: EvalModel, testCase: AgentEvalCase): Promise<AgentRun> {
  if (testCase.agent === "legal") return { answer: await model.write(fixedLegalMessages(String(testCase.script.passage ?? ""))), calls: [] };
  const wanted: ToolArea[] = [];
  const chatTools = storeTools(true);
  const toolsNow = () => (testCase.agent === "manager" ? managerTools(testCase, wanted) : chatTools);
  const messages: ToolChatMessage[] = [
    { role: "system", content: testCase.agent === "manager" ? fixedManagerPrompt() : fixedChatPrompt() },
    { role: "user", content: testCase.says },
  ];
  const run: AgentRun = { answer: "", calls: [] };
  for (let step = 0; step < STEPS; step++) {
    const last = step === STEPS - 1;
    const reply = await model.step(messages, last ? [] : toolsNow());
    if (reply.toolCalls.length === 0) {
      run.answer = reply.content ?? "";
      return run;
    }
    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) });
    for (const call of reply.toolCalls) {
      run.calls.push({ name: call.name, arguments: call.arguments });
      if (testCase.agent === "manager" && call.name === LOAD_TOOLS) {
        wanted.push(...readLoadTools(call.arguments));
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ loaded: "The tools of those areas are yours from the next step on." }) });
        continue;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(scripted(testCase, call.name)) });
    }
  }
  return run;
}

/** Plays every case, a few at a time, and scores them; `modelFor` gives each case its model. */
async function playCases(modelFor: (testCase: AgentEvalCase) => EvalModel, label: string): Promise<AgentEvalResult> {
  const started = Date.now();
  const failures: AgentEvalResult["failures"] = [];
  let passed = 0;
  for (let i = 0; i < AGENT_EVAL_CASES.length; i += AT_ONCE) {
    await Promise.all(
      AGENT_EVAL_CASES.slice(i, i + AT_ONCE).map(async (testCase) => {
        let problems: string[];
        let answer = "";
        try {
          const run = await runCase(modelFor(testCase), testCase);
          answer = run.answer;
          problems = scoreAgentCase(testCase, run, GATED);
        } catch (error) {
          problems = [`the model failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)];
        }
        if (problems.length === 0) passed++;
        else failures.push({ id: testCase.id, problems, answer: answer.slice(0, 300) });
      }),
    );
  }
  const total = AGENT_EVAL_CASES.length;
  return { model: label, passed, total, ok: passed / total >= AGENT_PASS_RATE, ms: Date.now() - started, failures };
}

/** Runs every case against the connection's text model, scores them and keeps the run with its prompt versions and its recording. */
export async function runAgentEval(connection: AiConnection, account: Pick<Account, "id">): Promise<AgentEvalResult> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const recorded = new Map<string, RecordedReply[]>();
  const result = await playCases((testCase) => {
    const replies: RecordedReply[] = [];
    recorded.set(testCase.id, replies);
    return liveModel(connection, replies);
  }, connection.textModel);
  const prompts = promptVersions();
  const recording: EvalRecording = {
    v: 1,
    model: connection.textModel,
    provider: connection.provider,
    recordedAt: new Date().toISOString(),
    prompts,
    cases: AGENT_EVAL_CASES.map((c) => ({ id: c.id, agent: c.agent, replies: recorded.get(c.id) ?? [] })),
  };
  try {
    await db().execute(sql`
      insert into commerce.ai_eval_runs (suite, provider, model, passed, total, failures, duration_ms, ran_by, prompt_versions, recording)
      values ('agents', ${connection.provider}, ${result.model}, ${result.passed}, ${result.total}, ${JSON.stringify(result.failures)}::jsonb, ${result.ms},
        ${account.id}::uuid, ${JSON.stringify(prompts)}::jsonb, ${JSON.stringify(recording)}::jsonb)`);
  } catch (error) {
    log("warn", "ai_eval.record_failed", { model: result.model }, error);
  }
  return result;
}

/** Plays a recording back through the harness as it is now (D391): no model, nothing kept. The caller checks `recordingProblems()` first. */
export async function replayAgentEval(recording: EvalRecording): Promise<AgentEvalResult> {
  const byId = new Map(recording.cases.map((c) => [c.id, c]));
  return playCases((testCase) => recordedModel(byId.get(testCase.id) ?? { id: testCase.id, agent: testCase.agent, replies: [] }), `${recording.model} (recorded)`);
}

const RUN_ROW = z.object({ id: col.uuid, model: col.text, provider: col.text, passed: col.int, total: col.int, ran_at: col.timestamp, prompts: z.unknown(), recorded: col.bool });

export type AgentEvalRunRow = { id: string; model: string; provider: string; passed: number; total: number; ranAt: string; prompts: Record<string, string> | null; recorded: boolean };

/** The latest runs, newest first, for the AI page: with their prompt versions and whether a recording can be downloaded. */
export type ManagerRating = { version: string; up: number; down: number };

/**
 * The owners' thumbs on the AI manager's answers, counted by the prompt version each answer was written under (PSI AGT-14): the labels a
 * new prompt version is compared by. Counts only, never a conversation's words; the newest versions first.
 */
export async function managerRatingsByVersion(limit = 8): Promise<ManagerRating[]> {
  return typedRows(
    z.object({ version: z.string(), up: col.int, down: col.int }),
    sql`select prompt_version as version, count(*) filter (where feedback = 1)::int as up, count(*) filter (where feedback = -1)::int as down
        from commerce.assistant_messages where feedback is not null and prompt_version is not null
        group by prompt_version order by max(created_at) desc limit ${limit}`,
  );
}

export async function recentAgentEvalRuns(limit = 5): Promise<AgentEvalRunRow[]> {
  const rows = await typedRows(RUN_ROW, sql`
    select id, model, provider, passed, total, ran_at, prompt_versions as prompts, recording is not null as recorded
      from commerce.ai_eval_runs where suite = 'agents' order by ran_at desc limit ${limit}`);
  return rows.map((r) => ({
    id: r.id,
    model: r.model,
    provider: r.provider,
    passed: r.passed,
    total: r.total,
    ranAt: r.ran_at,
    prompts: r.prompts && typeof r.prompts === "object" ? (r.prompts as Record<string, string>) : null,
    recorded: r.recorded,
  }));
}

/** A run's recording, for the platform's download (`/admin/platform/ai/eval/{run}/recording`). */
export async function agentEvalRecording(runId: string): Promise<EvalRecording | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const row = await typedRow(z.object({ recording: z.unknown() }), sql`
    select recording from commerce.ai_eval_runs where id = ${runId}::uuid and suite = 'agents'`);
  return (row?.recording as EvalRecording | null | undefined) ?? null;
}
