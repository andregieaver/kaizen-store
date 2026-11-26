import { z } from "zod";

import { isMeasuredScreen } from "./admin-screens";
import { UNTRUSTED_TEXT } from "./prompt-safety";

/**
 * Learning from how store owners use the admin (D895 phase 3a, the plan's section 8.2), pure: the week's figures as code works them out from
 * signals the platform already keeps as counts (the AI manager's tool calls and thumbs, the admin's speed), the prompt that hands them to the
 * platform's AI, and the check of its answer. The model is given figures only, never a person or a message; every proposal it makes must name
 * a tool or screen it was given and cite a number that is in the figures, or code drops it. In phase 3b (IA-16b) the admin heatmaps' figures
 * per screen join them, and the notes of up to five recordings on the screens they point at: what happened, written by code from events
 * that were scrubbed of every word when kept (`recordingNote()`), never a recording itself (`docs/dpia-admin-use.md`).
 */

/** A figure counts only above these volumes (as D656 leaves out what is below its minimum, never guessed). */
export const MIN_TOOL_CALLS = 20;
export const MIN_RATED = 5;
/** Proposals a reading may make. */
export const MAX_READING_PROPOSALS = 3;

export type ToolFigure = { tool: string; calls: number; failed: number; failedPct: number; up: number; down: number };
export type ScreenFigure = { screen: string; kind: string; loads: number; metric: "lcp" | "inp"; p75Ms: number; rating: string };
/** An admin screen's heatmap figures over the week (`admin-use-figures.ts`), only where its shares are above their minimum. */
export type UseFigure = { screen: string; views: number; frustratedPct: number; endPct: number; deadClicks: number; rageClicks: number };
/** A recording's note: its label in the message (`r1`…), its id for the evidence, its screens and what happened, as code wrote it. */
export type RecordingNote = { label: string; id: string; screens: string[]; text: string };
export type AdminFigures = { from: string; to: string; tools: ToolFigure[]; screens: ScreenFigure[]; use?: UseFigure[]; notes?: RecordingNote[] };

/** Admin screens a reading is given, and recordings it may read the notes of. */
export const MAX_USE_SCREENS = 8;
export const MAX_RECORDING_NOTES = 5;
const MAX_NOTE_STEPS = 12;

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * What happened in a recording, in words code chooses: each screen opened and each click that did nothing or burst, with its time from the
 * start, from the `kz-page` and `kz-click` events alone (every other event, and every word, is left out). At most twelve steps, then the
 * length. Null for a recording with nothing to say.
 */
export function recordingNote(events: readonly unknown[]): string | null {
  const steps: string[] = [];
  let start: number | null = null;
  let last = 0;
  for (const raw of events) {
    const e = raw as { type?: unknown; timestamp?: unknown; data?: { tag?: unknown; payload?: Record<string, unknown> } };
    if (typeof e.timestamp !== "number") continue;
    start ??= e.timestamp;
    last = Math.max(last, e.timestamp);
    if (e.type !== 5 || !e.data || steps.length >= MAX_NOTE_STEPS) continue;
    const at = clock(e.timestamp - start);
    const payload = e.data.payload ?? {};
    if (e.data.tag === "kz-page" && typeof payload.path === "string" && isMeasuredScreen(payload.path)) steps.push(`${at} opened ${payload.path}`);
    else if (e.data.tag === "kz-click" && payload.rage === true) steps.push(`${at} a burst of clicks`);
    else if (e.data.tag === "kz-click" && payload.dead === true) steps.push(`${at} a click that did nothing`);
  }
  if (steps.length === 0 || start === null) return null;
  return `${steps.join("; ")}; ended at ${clock(last - start)}`;
}

/** A whole percentage, as code works it out. */
export const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

/** The tools worth reading: enough calls, and either failing or rated down at least once. */
export function toolsWorthReading(tools: readonly ToolFigure[]): ToolFigure[] {
  return tools.filter((t) => t.calls >= MIN_TOOL_CALLS && (t.failed > 0 || (t.up + t.down >= MIN_RATED && t.down > 0)));
}

/** Whether the week holds anything to read. */
export const worthReading = (figures: AdminFigures) => figures.tools.length > 0 || figures.screens.length > 0 || (figures.use?.length ?? 0) > 0;

export const READING_SYSTEM = [
  "You read one week of figures about how store owners use Kaizena Flow's admin, and propose at most three improvements to the product.",
  "The figures were worked out in code. Use only them: every proposal names one tool or screen exactly as written in the figures, and cites",
  "one number exactly as it appears there. Never invent a number, a tool, a screen or a person. Never do arithmetic of your own.",
  "Propose what would most help owners: a tool that fails or is rated down, a screen that is slow, an admin screen where clicks do nothing or",
  "come in bursts. A recording's note says what owners did on such a screen, in words code wrote; use it to say what they tried, never cite",
  "a number from it.",
  'Answer JSON only: {"proposals":[{"subject":"<tool or screen as written>","title":"<at most 120 characters>","why":"<one sentence>","figure":<the number cited>}]}.',
  UNTRUSTED_TEXT,
].join("\n");

/** The figures as the model reads them: one line each, names as code writes them. */
export function readingMessage(figures: AdminFigures): string {
  const tools = figures.tools.map(
    (t) => `tool ${t.tool}: ${t.calls} calls, ${t.failed} failed (${t.failedPct}%), ${t.up} thumbs up, ${t.down} thumbs down`,
  );
  const screens = figures.screens.map((s) => `screen ${s.screen} (${s.kind}): ${s.loads} loads, ${s.metric} p75 ${s.p75Ms} ms, ${s.rating}`);
  const use = (figures.use ?? []).map(
    (u) =>
      `admin screen ${u.screen}: ${u.views} views, ${u.frustratedPct}% with a dead or rage click, ${u.endPct}% scrolled to the end, ${u.deadClicks} dead clicks, ${u.rageClicks} rage clicks`,
  );
  const notes = (figures.notes ?? []).map((n) => `recording ${n.label} (${n.screens.join(", ")}): ${n.text}`);
  return [`The week ${figures.from} to ${figures.to}.`, ...tools, ...screens, ...use, ...notes].join("\n");
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
    const use = (figures.use ?? []).find((u) => u.screen === p.subject);
    const numbers = tool
      ? [tool.calls, tool.failed, tool.failedPct, tool.up, tool.down]
      : screen
        ? [screen.loads, screen.p75Ms]
        : use
          ? [use.views, use.frustratedPct, use.endPct, use.deadClicks, use.rageClicks]
          : [];
    if (!numbers.includes(p.figure)) continue;
    used.add(p.subject);
    // The recordings on that screen go with an admin screen's proposal, by id, so the owner can watch them before approving.
    const recordings = use ? (figures.notes ?? []).filter((n) => n.screens.includes(use.screen)).map((n) => n.id) : [];
    const facts: Record<string, string | number> = tool
      ? { tool: tool.tool, calls: tool.calls, failed: tool.failed, failedPct: tool.failedPct, up: tool.up, down: tool.down }
      : screen
        ? { screen: screen.screen, kind: screen.kind, loads: screen.loads, metric: screen.metric, p75Ms: screen.p75Ms, rating: screen.rating }
        : {
            adminScreen: use!.screen,
            views: use!.views,
            frustratedPct: use!.frustratedPct,
            endPct: use!.endPct,
            deadClicks: use!.deadClicks,
            rageClicks: use!.rageClicks,
            ...(recordings.length > 0 ? { recordings: recordings.join(",") } : {}),
          };
    kept.push({ subject: p.subject, title: p.title.replace(/\s+/g, " ").trim(), why: p.why.replace(/\s+/g, " ").trim(), figure: p.figure, facts });
  }
  return kept;
}
