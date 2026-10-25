import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { AGENT_EVAL_CASES, AGENT_PASS_RATE, scoreAgentCase, type AgentEvalCase, type AgentRun } from "@/lib/agent-eval";
import { storeTools, systemPrompt } from "@/lib/chat";
import { assembleLegalFacts } from "@/lib/legal-facts";
import { jurisdictionsFor } from "@/lib/legal-sources";
import { starterFactWords } from "@/lib/legal-starters";
import { factSheet, planLegalPage, writerMessages, writerSettings } from "@/lib/legal-writer";
import { MANAGER_TOOLS } from "@/lib/manager-tools";
import { OWNER_TOOLS, toolDefinition } from "@/lib/owner-tools";

import { AiError, chatWithTools, completeText, type AiConnection, type ToolChatMessage, type ToolDefinition } from "./ai";
import { log } from "./log";
import { managerPrompt, type Principal } from "./owner-assistant";
import { getStore } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Runs the agents' safety eval (`src/lib/agent-eval.ts`, PSI 2026-10-24 AST-09) against a connection's text model: each case gets
 * its agent's real prompt and real tool definitions (the template store's, as an owner sees it), and every tool call is answered from
 * the case's script; nothing is read, written, sent or charged. The run is kept in `commerce.ai_eval_runs`.
 */

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

/** What a scripted tool answers: the case's, a gated tool's "kept for approval" as the manager's own turns say, or nothing found. */
function scripted(testCase: AgentEvalCase, name: string): unknown {
  if (name in testCase.script) return testCase.script[name];
  if (testCase.agent === "manager" && GATED.has(name)) return { kept: "Kept for the owner's approval; it runs only when they say yes." };
  return { found: [], note: "Nothing found." };
}

/** The legal page writer's real prompt (D311) for a returns policy of a store in Norway, its one passage the case's. */
async function runLegalCase(connection: AiConnection, testCase: AgentEvalCase): Promise<AgentRun> {
  const facts = assembleLegalFacts({
    store: { name: "Eval Store", legalName: "Eval Store AS", organisationNumber: "999 888 777", contactEmail: "post@eval.example", postalAddress: "Storgata 1, 0155 Oslo", country: "NO", audience: "consumers", visitCounting: false, modules: [], tracking: {} },
    tax: { vatNumber: null, registered: true },
    markets: [{ code: "NO", currency: "NOK" }],
    shippingRates: [],
    carrierNames: [],
    returnSettings: null,
    chatOn: false,
    links: {},
    phone: null,
  });
  const sheet = factSheet(facts, starterFactWords(facts, "en"), "en");
  const passage = String(testCase.script.passage ?? "");
  const plan = planLegalPage({
    role: "returns_policy",
    language: "en",
    facts,
    sheet,
    jurisdictions: jurisdictionsFor(facts),
    texts: [{ sourceKey: "eu-crd", language: "en", readAt: new Date(), passages: ["art_9", "art_11", "art_13", "art_14", "art_16"].map((key) => ({ key, title: `Article ${key.slice(4)}`, text: passage })) }],
  });
  const answer = await completeText(connection, writerMessages(plan, sheet, writerSettings(facts)), { maxTokens: 4000, timeoutMs: 120_000, temperature: 0.2 });
  return { answer: answer.text, calls: [] };
}

async function runCase(connection: AiConnection, testCase: AgentEvalCase, prompts: { chat: string; manager: string }, tools: { chat: ToolDefinition[]; manager: ToolDefinition[] }): Promise<AgentRun> {
  if (testCase.agent === "legal") return runLegalCase(connection, testCase);
  const messages: ToolChatMessage[] = [
    { role: "system", content: prompts[testCase.agent] },
    { role: "user", content: testCase.says },
  ];
  const run: AgentRun = { answer: "", calls: [] };
  for (let step = 0; step < STEPS; step++) {
    const last = step === STEPS - 1;
    const reply = await chatWithTools(connection, messages, last ? [] : tools[testCase.agent], { maxTokens: 600, timeoutMs: 45_000 });
    if (reply.toolCalls.length === 0) {
      run.answer = reply.content ?? "";
      return run;
    }
    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
    for (const call of reply.toolCalls) {
      run.calls.push({ name: call.function.name, arguments: call.function.arguments });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(scripted(testCase, call.function.name)) });
    }
  }
  return run;
}

/** Runs every case, a few at a time, scores them and keeps the run. */
export async function runAgentEval(connection: AiConnection, principal: Principal): Promise<AgentEvalResult> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const store = principal.store;
  if (!store) throw new AiError("The eval needs a store to play.");
  const started = Date.now();
  const prompts = {
    chat: systemPrompt({
      site: store.name,
      kind: "store",
      agentName: "",
      occupation: "",
      lang: "en",
      instructions: "",
      path: null,
      today: new Date().toISOString().slice(0, 10),
    }),
    manager: managerPrompt(principal),
  };
  const tools = { chat: storeTools(true), manager: [...OWNER_TOOLS, ...MANAGER_TOOLS].map(toolDefinition) };
  const failures: AgentEvalResult["failures"] = [];
  let passed = 0;
  for (let i = 0; i < AGENT_EVAL_CASES.length; i += AT_ONCE) {
    await Promise.all(
      AGENT_EVAL_CASES.slice(i, i + AT_ONCE).map(async (testCase) => {
        let problems: string[];
        let answer = "";
        try {
          const run = await runCase(connection, testCase, prompts, tools);
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
  const result: AgentEvalResult = { model: connection.textModel, passed, total, ok: passed / total >= AGENT_PASS_RATE, ms: Date.now() - started, failures };
  try {
    await db().execute(sql`
      insert into commerce.ai_eval_runs (suite, provider, model, passed, total, failures, duration_ms, ran_by)
      values ('agents', ${connection.provider}, ${result.model}, ${passed}, ${total}, ${JSON.stringify(failures)}::jsonb, ${result.ms}, ${principal.account.id}::uuid)`);
  } catch (error) {
    log("warn", "ai_eval.record_failed", { model: result.model }, error);
  }
  return result;
}

/** The template store as an owner sees it, the stage the manager's cases play on. */
export async function evalPrincipal(account: Principal["account"]): Promise<Principal | null> {
  const row = await typedRow(z.object({ slug: col.text }), sql`select slug from commerce.stores where is_template order by created_at limit 1`);
  const store = row ? await getStore(row.slug) : null;
  return store ? { account, store, role: "owner" } : null;
}

const RUN_ROW = z.object({ model: col.text, provider: col.text, passed: col.int, total: col.int, ran_at: col.timestamp });

/** The latest runs, newest first, for the AI page. */
export async function recentAgentEvalRuns(limit = 5): Promise<{ model: string; provider: string; passed: number; total: number; ranAt: string }[]> {
  const rows = await typedRows(RUN_ROW, sql`
    select model, provider, passed, total, ran_at from commerce.ai_eval_runs where suite = 'agents' order by ran_at desc limit ${limit}`);
  return rows.map((r) => ({ model: r.model, provider: r.provider, passed: r.passed, total: r.total, ranAt: r.ran_at }));
}
