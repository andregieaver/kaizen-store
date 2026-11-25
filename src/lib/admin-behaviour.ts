import { z } from "zod";

import { UNTRUSTED_TEXT } from "./prompt-safety";

/**
 * Learning from how store owners use the admin (D895 phase 3a, the plan's section 8.2), pure: the week's figures as code works them out from
 * signals the platform already keeps as counts (the AI manager's tool calls and thumbs, the admin's speed), the prompt that hands them to the
 * platform's AI, and the check of its answer. The model is given figures only, never a person or a message; every proposal it makes must name
 * a tool or screen it was given and cite a number that is in the figures, or code drops it. Admin heatmaps and recordings join these figures
 * in phase 3b, after the owner's and the lawyer's sign-off (`docs/dpia-admin-use.md`).
 */

/** A figure counts only above these volumes (as D656 leaves out what is below its minimum, never guessed). */
export const MIN_TOOL_CALLS = 20;
export const MIN_RATED = 5;
/** Proposals a reading may make. */
export const MAX_READING_PROPOSALS = 3;

export type ToolFigure = { tool: string; calls: number; failed: number; failedPct: number; up: number; down: number };
export type ScreenFigure = { screen: string; kind: string; loads: number; metric: "lcp" | "inp"; p75Ms: number; rating: string };
export type AdminFigures = { from: string; to: string; tools: ToolFigure[]; screens: ScreenFigure[] };

/** A whole percentage, as code works it out. */
export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/** The tools worth reading: enough calls, and either failing or rated down at least once. */
export function toolsWorthReading(tools: readonly ToolFigure[]): ToolFigure[] {
  return tools.filter((t) => t.calls >= MIN_TOOL_CALLS && (t.failed > 0 || (t.up + t.down >= MIN_RATED && t.down > 0)));
}

/** Whether the week holds anything to read. */
export const worthReading = (figures: AdminFigures) => figures.tools.length > 0 || figures.screens.length > 0;

export const READING_SYSTEM = [
  "You read one week of figures about how store owners use Kaizena Flow's admin, and propose at most three improvements to the product.",
  "The figures were worked out in code. Use only them: every proposal names one tool or screen exactly as written in the figures, and cites",
  "one number exactly as it appears there. Never invent a number, a tool, a screen or a person. Never do arithmetic of your own.",
  "Propose what would most help owners: a tool that fails or is rated down, a screen that is slow.",
  'Answer JSON only: {"proposals":[{"subject":"<tool or screen as written>","title":"<at most 120 characters>","why":"<one sentence>","figure":<the number cited>}]}.',
  UNTRUSTED_TEXT,
].join("\n");

/** The figures as the model reads them: one line each, names as code writes them. */
export function readingMessage(figures: AdminFigures): string {
  const tools = figures.tools.map(
    (t) => `tool ${t.tool}: ${t.calls} calls, ${t.failed} failed (${t.failedPct}%), ${t.up} thumbs up, ${t.down} thumbs down`,
  );
  const screens = figures.screens.map((s) => `screen ${s.screen} (${s.kind}): ${s.loads} loads, ${s.metric} p75 ${s.p75Ms} ms, ${s.rating}`);
  return [`The week ${figures.from} to ${figures.to}.`, ...tools, ...screens].join("\n");
}

const answerShape = z.object({
  proposals: z
    .array(z.object({ subject: z.string().min(1).max(80), title: z.string().min(1).max(200), why: z.string().min(1).max(500), figure: z.number() }))
    .max(10),
});

export type CheckedProposal = { subject: string; title: string; why: string; figure: number; facts: Record<string, string | number> };

/**
 * The model's answer, checked in code: JSON of the right shape; each proposal's subject a tool or screen of the figures; its figure one of
 * that subject's own numbers; one proposal a subject; at most `MAX_READING_PROPOSALS`. Anything else is dropped, never repaired.
 */
export function checkReading(text: string, figures: AdminFigures): CheckedProposal[] {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let parsed: z.infer<typeof answerShape>;
  try {
    parsed = answerShape.parse(JSON.parse(json));
  } catch {
    return [];
  }
  const kept: CheckedProposal[] = [];
  const used = new Set<string>();
  for (const p of parsed.proposals) {
    if (kept.length >= MAX_READING_PROPOSALS || used.has(p.subject)) continue;
    const tool = figures.tools.find((t) => t.tool === p.subject);
    const screen = figures.screens.find((s) => s.screen === p.subject);
    const numbers = tool ? [tool.calls, tool.failed, tool.failedPct, tool.up, tool.down] : screen ? [screen.loads, screen.p75Ms] : [];
    if (!numbers.includes(p.figure)) continue;
    used.add(p.subject);
    const facts: Record<string, string | number> = tool
      ? { tool: tool.tool, calls: tool.calls, failed: tool.failed, failedPct: tool.failedPct, up: tool.up, down: tool.down }
      : { screen: screen!.screen, kind: screen!.kind, loads: screen!.loads, metric: screen!.metric, p75Ms: screen!.p75Ms, rating: screen!.rating };
    kept.push({ subject: p.subject, title: p.title.replace(/\s+/g, " ").trim(), why: p.why.replace(/\s+/g, " ").trim(), figure: p.figure, facts });
  }
  return kept;
}
