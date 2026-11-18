import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { ADMIN_PAGES } = await import("@/lib/admin-map");
const { areaOfPath } = await import("@/lib/permissions");
const { AREAS } = await import("@/lib/permission-keys");
const { offeredTools } = await import("./offered-tools");
const { holderOfPrincipal } = await import("./owner-assistant");
const { AGENT_LIMITS, drawFixedRounds, drawManagerRound, fixedOwnerWith } = await import("./ai-round");
type RoundDraw = import("./ai-round").RoundDraw;
type AgentLimit = import("./ai-round").AgentLimit;

/**
 * Every agent's round, held (bloat review step 1.19): the characters each agent sends a model in one call, drawn by `ai-round.ts` with
 * fixed inputs, against `ai-round.baseline.json`. A round above its baseline fails, naming the tools that grew most; a tool over 2,500
 * characters that the baseline does not list fails ('split it or say why'), and a listed one that grew; a changed output limit or
 * reasoning effort fails. A figure below its baseline fails too, until `node scripts/ai-round.mjs` lowers it, so a gain is kept. With
 * UPDATE_BASELINE=1 (the script) the file is written, refusing a figure that rose unless FIRST=1 (`--first`).
 */

const FILE = new URL("./ai-round.baseline.json", import.meta.url);
const UPDATE = process.env.UPDATE_BASELINE === "1";
const FIRST = process.env.FIRST === "1";
/** A tool this large is split, or the baseline's `largeTools` says it is kept so. */
const LARGE_TOOL = 2500;
const FIELDS = ["promptChars", "toolCount", "toolChars", "alwaysSentChars", "totalChars"] as const;
const LOWER = "run node scripts/ai-round.mjs to lower the baseline, and commit it with the change";

type Figures = Pick<RoundDraw, (typeof FIELDS)[number]> & { case?: string };
type Baseline = {
  manager: Record<string, Figures>;
  fixed: Record<string, Figures>;
  largeTools: Record<string, number>;
  /** Every tool a drawn round sends, by its length as sent: only to name what grew, never held itself. */
  tools: Record<string, number>;
  limits: Record<string, AgentLimit>;
};

/** One admin path for each area of the tool budget (`ToolArea`): the first store page of that area. */
function pathsByArea(): Map<string, string> {
  const paths = new Map<string, string>();
  for (const page of ADMIN_PAGES) {
    if (page.area !== "store") continue;
    const area = areaOfPath(page.path);
    if (area && !paths.has(area)) paths.set(area, page.path);
  }
  return paths;
}

/**
 * The manager's round with no page and on a page of each area, for a shop-only store and one with every feature on. The round depends on the
 * page only through its area (`areaOfPath()`, as `runTurn()` reads it), so every page of an area draws the same round: the first is drawn.
 */
function managerDraws(): Map<string, RoundDraw> {
  const draws = new Map<string, RoundDraw>();
  const paths = pathsByArea();
  for (const features of ["shop", "all"] as const) {
    draws.set(`${features}|none`, drawManagerRound({ features, path: null }));
    for (const area of AREAS) {
      const path = paths.get(area);
      if (path) draws.set(`${features}|${area}`, drawManagerRound({ features, path }));
    }
  }
  return draws;
}

const manager = managerDraws();
const fixed: Record<string, RoundDraw & { case?: string }> = drawFixedRounds();
const QUESTIONS = JSON.parse(readFileSync(new URL("../data/ai-round-questions.json", import.meta.url), "utf8")) as { id: string; says: string }[];

const figuresOf = (draw: RoundDraw & { case?: string }): Figures => ({
  ...Object.fromEntries(FIELDS.map((field) => [field, draw[field]])),
  ...(draw.case !== undefined && { case: draw.case }),
}) as Figures;
const sorted = <T,>(record: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The name a tool is known by in the baseline: the store's, the manager's and the autopilot's tools by their own name; the shopper chat's,
 * the guide's and the platform's under their agent (`chat/get_product`), as some share a name with a store tool.
 */
const OWN_SCOPE: ReadonlySet<string> = new Set(["chat", "chat_support", "guide", "platform"]);
const scopeOf = (agent: string | null) => (agent && OWN_SCOPE.has(agent) ? `${agent}/` : "");

function current(): Baseline {
  const tools: Record<string, number> = {};
  for (const draw of manager.values()) for (const tool of draw.tools) tools[tool.name] = tool.chars;
  for (const [agent, draw] of Object.entries(fixed)) for (const tool of draw.tools) tools[`${scopeOf(agent)}${tool.name}`] = tool.chars;
  return {
    manager: Object.fromEntries([...manager].map(([key, draw]) => [key, figuresOf(draw)])),
    fixed: Object.fromEntries(Object.entries(fixed).map(([key, draw]) => [key, figuresOf(draw)])),
    largeTools: sorted(Object.fromEntries(Object.entries(tools).filter(([, chars]) => chars > LARGE_TOOL))),
    tools: sorted(tools),
    limits: Object.fromEntries(Object.entries(AGENT_LIMITS).map(([agent, limit]) => [agent, { maxTokens: limit.maxTokens, reasoningEffort: limit.reasoningEffort }])),
  };
}

const n = (value: number) => value.toLocaleString("en-GB");

/** The three tools of a round that grew most against the baseline's lengths (a tool it did not know counts whole). */
function grewMost(draw: RoundDraw, known: Record<string, number>, scope: string): string {
  const grown = draw.tools
    .map((tool) => ({ name: `${scope}${tool.name}`, chars: tool.chars }))
    .map((tool) => ({ name: tool.name, by: tool.chars - (known[tool.name] ?? 0), added: !(tool.name in known) }))
    .filter((tool) => tool.by > 0)
    .sort((a, b) => b.by - a.by)
    .slice(0, 3);
  return grown.length ? grown.map((t) => `${t.name} (${t.added ? "new, " : "+"}${n(t.by)})`).join(", ") : "no tool (the prompt grew)";
}

type Findings = { rose: string[]; fell: string[]; limits: string[]; limitRaised: boolean };

function compare(now: Baseline, base: Baseline): Findings {
  const findings: Findings = { rose: [], fell: [], limits: [], limitRaised: false };
  const rounds = (
    agentOf: (key: string) => string,
    nowRounds: Record<string, Figures>,
    baseRounds: Record<string, Figures>,
    draws: (key: string) => RoundDraw | undefined,
    scope: (key: string) => string,
  ) => {
    for (const key of Object.keys(nowRounds)) {
      const was = baseRounds[key];
      const is = nowRounds[key];
      const name = agentOf(key);
      if (!was) {
        findings.rose.push(`${name}: a round the baseline does not hold (${n(is.totalChars)} characters)`);
        continue;
      }
      const rose = FIELDS.filter((field) => is[field] > was[field]);
      const fell = FIELDS.filter((field) => is[field] < was[field]);
      if (rose.length) {
        const draw = draws(key);
        findings.rose.push(
          `${name}: ${rose.map((field) => `${field} ${n(is[field])}, baseline ${n(was[field])}`).join("; ")}. Grew most: ${draw ? grewMost(draw, base.tools, scope(key)) : "?"}`,
        );
      }
      if (fell.length) findings.fell.push(`${name}: ${fell.map((field) => `${field} ${n(is[field])}, baseline ${n(was[field])}`).join("; ")}`);
    }
    for (const key of Object.keys(baseRounds)) if (!(key in nowRounds)) findings.fell.push(`${agentOf(key)}: no longer drawn`);
  };
  rounds((key) => `the AI manager, ${key}`, now.manager, base.manager, (key) => manager.get(key), () => "");
  rounds((key) => key, now.fixed, base.fixed, (key) => fixed[key], (key) => scopeOf(key));
  for (const [tool, chars] of Object.entries(now.largeTools)) {
    const was = base.largeTools[tool];
    if (was === undefined) findings.rose.push(`${tool}: ${n(chars)} characters, over ${n(LARGE_TOOL)} and not on the baseline's largeTools: split it or say why`);
    else if (chars > was) findings.rose.push(`${tool}: a large tool that grew, ${n(chars)} characters, baseline ${n(was)}`);
    else if (chars < was) findings.fell.push(`${tool}: a large tool at ${n(chars)} characters, baseline ${n(was)}`);
  }
  for (const tool of Object.keys(base.largeTools)) if (!(tool in now.largeTools)) findings.fell.push(`${tool}: no longer a large tool`);
  for (const agent of new Set([...Object.keys(now.limits), ...Object.keys(base.limits)])) {
    const is = now.limits[agent];
    const was = base.limits[agent];
    if (is?.maxTokens === was?.maxTokens && is?.reasoningEffort === was?.reasoningEffort) continue;
    findings.limits.push(
      `the limit of ${agent}: maxTokens ${is?.maxTokens ?? "none"} and reasoning effort ${is?.reasoningEffort ?? "none"}, baseline ${was?.maxTokens ?? "none"} and ${was?.reasoningEffort ?? "none"}: a changed limit is a decision: update the baseline and docs/decisions.md`,
    );
    if ((is?.maxTokens ?? 0) > (was?.maxTokens ?? 0)) findings.limitRaised = true;
  }
  return findings;
}

const now = current();
const base: Baseline | null = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as Baseline) : null;

describe("every agent's round (bloat review step 1.19)", () => {
  if (UPDATE) {
    it("writes the baseline, refusing a figure that rose unless FIRST=1", () => {
      if (base && !FIRST) {
        const findings = compare(now, base);
        const refused = [...findings.rose, ...(findings.limitRaised ? findings.limits : [])];
        expect(refused, "These rose; pass --first to accept a rise, and give its reason in the commit message").toEqual([]);
      }
      writeFileSync(FILE, `${JSON.stringify(now, null, 2)}\n`);
    });
    return;
  }

  it("has a baseline", () => {
    expect(base, "write it with node scripts/ai-round.mjs --first").not.toBeNull();
  });

  const findings = base ? compare(now, base) : { rose: [], fell: [], limits: [], limitRaised: false };

  it("no round grew and no tool is newly large", () => {
    expect(findings.rose, "A round grew: cut it, or raise the baseline on purpose with node scripts/ai-round.mjs --first and say why in the commit").toEqual([]);
  });

  it("the output limits and reasoning efforts are the baseline's", () => {
    expect(findings.limits).toEqual([]);
  });

  it("no figure fell below the baseline without it being lowered", () => {
    expect(findings.fell, LOWER).toEqual([]);
  });

  it("would notice a tool 2,000 characters longer", () => {
    const owner = fixedOwnerWith("all");
    const offered = offeredTools({ store: owner.store, holder: holderOfPrincipal(owner) }).map((tool) =>
      tool.name === "list_orders" ? { ...tool, description: `${tool.description}${"x".repeat(2000)}` } : tool,
    );
    expect(offered.some((tool) => tool.name === "list_orders")).toBe(true);
    const longer = drawManagerRound({ features: "all", path: null, offered });
    expect(longer.totalChars).toBe(manager.get("all|none")!.totalChars + 2000);
  });

  it("draws the same round for each of the 20 owner questions as for none", () => {
    // A question changes the round only once step 2.36's router picks tools by it: until then each question's round is the round with none.
    // When the router lands, these draws differ and go into the baseline as rounds of their own.
    expect(QUESTIONS).toHaveLength(20);
    for (const features of ["shop", "all"] as const) {
      const none = manager.get(`${features}|none`)!;
      for (const question of QUESTIONS) expect(drawManagerRound({ features, path: null, question: question.says }).totalChars, question.id).toBe(none.totalChars);
    }
  });

  it("reads the output limits written as literals from the files that pass them", () => {
    // `runTurn()` passes no limit or effort to `streamWithTools()`, so the AI manager's limit is ai.ts's default (`AGENT_LIMITS.manager`).
    const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source("./owner-assistant.ts")).not.toMatch(/maxTokens|reasoningEffort/);
    for (const [file, agent] of [
      ["./chat-agent.ts", "chat"],
      ["./docs-guide.ts", "guide"],
      ["./autopilot-reports.ts", "autopilot_report"],
    ] as const) {
      const limits = [...source(file).matchAll(/maxTokens:\s*(\d[\d_]*)/g)].map((m) => Number(m[1].replace(/_/g, "")));
      expect(limits.length, `${file} passes an output limit`).toBeGreaterThan(0);
      expect(new Set(limits), `${file}: AGENT_LIMITS.${agent} in ai-round.ts says ${AGENT_LIMITS[agent].maxTokens}`).toEqual(new Set([AGENT_LIMITS[agent].maxTokens]));
      expect(source(file), `${file} passes a reasoning effort: add it to AGENT_LIMITS.${agent}`).not.toMatch(/reasoningEffort/);
    }
  });
});
