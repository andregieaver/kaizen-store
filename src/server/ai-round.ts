import "server-only";

import { EVENT_LINES, EVENT_TOOLS, type EventKind } from "@/lib/autopilot-events";
import { TASK_EXTRA_TOOLS } from "@/lib/autopilot-plans";
import { REVIEW_PLAN_TOOLS, REVIEW_READ_TOOLS } from "@/lib/autopilot-reviews";
import { storeTools } from "@/lib/chat";
import { MODERATION_OPTIONS } from "@/lib/content-moderation";
import { guideTools } from "@/lib/docs-guide";
import { BRIEF_OPTIONS, REWORK_OPTIONS } from "@/lib/dream-factory";
import { MANAGER_TOOLS } from "@/lib/manager-tools";
import { toolDefinition, type OwnerTool } from "@/lib/owner-tools";
import { areaOfPath } from "@/lib/permissions";
import { FEATURE_IDS } from "@/lib/store-features";
import { CORE_TOOLS, LOAD_TOOLS, type ToolArea } from "@/lib/tool-budget";

import { CHAT_TOOLS_MAX_TOKENS, STREAM_TOOLS_MAX_TOKENS, type ToolDefinition } from "./ai";
import { offeredTools } from "./offered-tools";
import { AUTOPILOT_LINES, REVIEW_LINES, fixedPlatformPrompt, fixedPrincipal, holderOfPrincipal, managerPrompt, roundTools } from "./owner-assistant";
import { PROMPT_DAY, fixedBriefMessages, fixedChatPrompt, fixedGuidePrompt, fixedReworkMessages } from "./prompt-versions";
import type { Store } from "./stores";

/**
 * Every agent's round, drawn (bloat review step 1.19): what one call of each agent sends a model, as characters of prompt and of tools,
 * for fixed inputs and with no database. The AI manager's round is drawn by the functions `runTurn()` uses (`roundTools()`,
 * `managerPrompt()`), for the fixed owner of `fixedPrincipal()` in a store with the shop only or with every feature on; the other agents'
 * from the fixed prompts of `prompt-versions.ts` and their tool lists. `ai-round.scan.test.ts` holds them to `ai-round.baseline.json`, so
 * a round that grows fails a test; `node scripts/ai-round.mjs` lowers the baseline after a change that shrinks one.
 */

export type RoundDraw = {
  promptChars: number;
  toolCount: number;
  /** The tools as sent: `JSON.stringify([{ type: "function", function: tool }, …])`. */
  toolChars: number;
  /** The part of `toolChars` every round sends whatever is asked: the manager's own tools, the core tools and `load_tools`. */
  alwaysSentChars: number;
  totalChars: number;
  /** The ten largest tools, by their length as sent. */
  largest: { name: string; chars: number }[];
  /** Every tool of the round, in the order sent, with its length as sent. */
  tools: { name: string; chars: number }[];
};

/** A tool's length as a round sends it. */
export const toolSentChars = (tool: ToolDefinition): number => JSON.stringify({ type: "function", function: tool }).length;

const CORE_AND_LOAD: ReadonlySet<string> = new Set([LOAD_TOOLS, ...CORE_TOOLS]);

/** A round's figures from its prompt and its tools; `always` names the tools that count as always sent. */
export function measureRound(promptChars: number, tools: readonly ToolDefinition[], always: ReadonlySet<string> = new Set()): RoundDraw {
  const toolChars = tools.length === 0 ? 0 : JSON.stringify(tools.map((tool) => ({ type: "function", function: tool }))).length;
  const sized = tools.map((tool) => ({ name: tool.name, chars: toolSentChars(tool) }));
  return {
    promptChars,
    toolCount: tools.length,
    toolChars,
    alwaysSentChars: sized.filter((t) => always.has(t.name)).reduce((n, t) => n + t.chars, 0),
    totalChars: promptChars + toolChars,
    largest: [...sized].sort((a, b) => b.chars - a.chars || a.name.localeCompare(b.name)).slice(0, 10),
    tools: sized,
  };
}

export type RoundFeatures = "shop" | "all";

/** The fixed owner's principal in a store with the shop only, or with every feature (and Work) on. */
export function fixedOwnerWith(features: RoundFeatures) {
  const principal = fixedPrincipal({ id: "00000000-0000-4000-8000-000000000000" });
  const store = { ...principal.store, features: features === "all" ? [...FEATURE_IDS] : ["shop"], workOn: features === "all" } as Store;
  return { ...principal, store };
}

/** The manager's own tools as `runTurn()` sends them to an owner in their own turn (no Kaizen Life, no outside assistant). */
const managerDefinitions = (): ToolDefinition[] => MANAGER_TOOLS.map(toolDefinition);

/**
 * The AI manager's round for the fixed owner: its prompt (`managerPrompt()` as `fixedManagerPrompt()` draws it, with the store's features)
 * and the tools of the first round of a new conversation on `path` (an address after the store's, such as `/orders`; null for none).
 * `question` changes nothing until step 2.36's router chooses tools by it. `offered` replaces the store's tools (a test's modified copy).
 */
export function drawManagerRound(options: { features: RoundFeatures; path: string | null; question?: string; offered?: readonly OwnerTool[] }): RoundDraw {
  const p = fixedOwnerWith(options.features);
  const offered = options.offered ?? offeredTools({ store: p.store, holder: holderOfPrincipal(p) });
  const managerTools = managerDefinitions();
  const pageArea = options.path === null ? null : (areaOfPath(options.path) as ToolArea | null);
  const tools = roundTools({ offered, managerTools, appDefinitions: [], used: [], wanted: [], pageArea, allowed: null });
  const always = new Set([...managerTools.map((t) => t.name), ...CORE_AND_LOAD]);
  return measureRound(managerPrompt(p, { now: PROMPT_DAY }).length, tools, always);
}

/** The fixed rounds of the other agents (and of the AI manager's platform and autopilot turns). */
export type FixedAgent = "chat" | "chat_support" | "guide" | "dream_brief" | "rework" | "autopilot_event" | "platform";

const messagesChars = (messages: readonly { content: string }[]) => messages.reduce((n, m) => n + m.content.length, 0);

/**
 * The autopilot's largest round (D309, D328, D331): the manager's prompt for a store with every feature on, plus each kind of event's lines
 * with its tools, a goal's review with its tools, or a plan step's lines with only the tools every step has (a step's own come from its plan).
 */
function largestAutopilotRound(): RoundDraw & { case: string } {
  const p = fixedOwnerWith("all");
  const offered = offeredTools({ store: p.store, holder: holderOfPrincipal(p) });
  const prompt = managerPrompt(p, { now: PROMPT_DAY });
  const cases: { case: string; lines: string; tools: readonly string[] }[] = [
    ...(Object.keys(EVENT_LINES) as EventKind[]).map((kind) => ({ case: `event:${kind}`, lines: EVENT_LINES[kind], tools: EVENT_TOOLS[kind] ?? [] })),
    { case: "review", lines: REVIEW_LINES, tools: [...REVIEW_PLAN_TOOLS, ...REVIEW_READ_TOOLS] },
    { case: "step", lines: AUTOPILOT_LINES, tools: [] },
  ];
  const draws = cases.map((c) => {
    const allowed = new Set<string>([...c.tools, ...TASK_EXTRA_TOOLS]);
    const tools = roundTools({ offered, managerTools: [], appDefinitions: [], used: [], wanted: [], pageArea: null, allowed });
    return { case: c.case, ...measureRound(`${prompt}\n\n${c.lines}`.length, tools) };
  });
  return draws.reduce((a, b) => (b.totalChars > a.totalChars ? b : a));
}

/** The seven fixed rounds. 'chat' is a store's chat with the shop off (a website), 'chat_support' with the shop on (`storeTools(true)`). */
export function drawFixedRounds(): Record<FixedAgent, RoundDraw & { case?: string }> {
  const platformManager = managerDefinitions();
  const platformTools = roundTools({ offered: offeredTools({ store: null }), managerTools: platformManager, appDefinitions: [], used: [], wanted: [], pageArea: null, allowed: null });
  return {
    chat: measureRound(fixedChatPrompt().length, storeTools(false)),
    chat_support: measureRound(fixedChatPrompt().length, storeTools(true)),
    guide: measureRound(fixedGuidePrompt().length, guideTools()),
    dream_brief: measureRound(messagesChars(fixedBriefMessages("x")), []),
    rework: measureRound(messagesChars(fixedReworkMessages("x", { storeName: "Eval Store", open: false, look: "", pages: [], products: [] })), []),
    autopilot_event: largestAutopilotRound(),
    platform: measureRound(fixedPlatformPrompt().length, platformTools, new Set([...platformManager.map((t) => t.name), LOAD_TOOLS])),
  };
}

export type AgentLimit = { maxTokens: number; reasoningEffort: string | null };

/** An options object's reasoning effort, or null when it asks for none. */
const effortOf = (options: object): string | null => {
  const effort = (options as { reasoningEffort?: unknown }).reasoningEffort;
  return typeof effort === "string" ? effort : null;
};

/**
 * What each agent's calls ask of the model today: the output limit and the reasoning effort (none: the provider's default). Read from the
 * code: the defaults of `src/server/ai.ts` and the options each agent's file exports; the three limits written as literals where they are
 * passed (the chat's rounds in `chat-agent.ts`, the docs guide's in `docs-guide.ts`, the autopilot report's in `autopilot-reports.ts`) are
 * checked against those files by `ai-round.scan.test.ts`.
 */
export const AGENT_LIMITS: Record<string, AgentLimit> = {
  /** `runTurn()` passes no `maxTokens` to `streamWithTools()`. */
  manager: { maxTokens: STREAM_TOOLS_MAX_TOKENS, reasoningEffort: null },
  /** A round of `chatWithTools()` that gives no limit. */
  tools_default: { maxTokens: CHAT_TOOLS_MAX_TOKENS, reasoningEffort: null },
  chat: { maxTokens: 600, reasoningEffort: null },
  guide: { maxTokens: 700, reasoningEffort: null },
  autopilot_report: { maxTokens: 300, reasoningEffort: null },
  moderation: { maxTokens: MODERATION_OPTIONS.maxTokens, reasoningEffort: effortOf(MODERATION_OPTIONS) },
  dream_brief: { maxTokens: BRIEF_OPTIONS.maxTokens, reasoningEffort: effortOf(BRIEF_OPTIONS) },
  rework: { maxTokens: REWORK_OPTIONS.maxTokens, reasoningEffort: effortOf(REWORK_OPTIONS) },
};
