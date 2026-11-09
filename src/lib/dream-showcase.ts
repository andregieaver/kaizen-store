import { DREAM_STEPS, type AllSteps, type AnyStepId, type DreamStep, type DreamSteps } from "./dream-factory";

/**
 * Watching the Dream Factory build (D419): what the owner's page shows while a run goes, worked out from the run's steps and what the steps
 * have made so far (`src/server/dream-showcase.ts` reads it). Pure: the progress, what is happening now and next, each step's minutes, the
 * feed of what was just made, and the mock-up's colours and fonts made safe to put in a style. Nothing here is a model's words: every line
 * is the code's, from the store's own records.
 */

export type ShowcaseProgress = {
  /** Steps passed (done or skipped), of all. */
  done: number;
  total: number;
  percent: number;
  /** The steps working or waiting for the owner now, in the page's order. */
  now: AnyStepId[];
  /** The first step still waiting, when nothing is working. */
  next: AnyStepId | null;
  /** Whole minutes since the run started. */
  minutes: number;
};

/** `list`: the steps of the run's kind (a build's unless given, D527). */
export function showcaseProgress(given: DreamSteps | AllSteps, startedAt: Date, now: Date, list: readonly DreamStep<AnyStepId>[] = DREAM_STEPS): ShowcaseProgress {
  const steps = given as AllSteps;
  const total = list.length;
  const done = list.filter((s) => steps[s.id].status === "done" || steps[s.id].status === "skipped").length;
  const working = list.filter((s) => steps[s.id].status === "running" || steps[s.id].status === "asking").map((s) => s.id);
  const next = working.length === 0 ? (list.find((s) => steps[s.id].status === "waiting")?.id ?? null) : null;
  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
    now: working,
    next,
    minutes: Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60_000)),
  };
}

/** How long a step took (finished) or has been working (running), in whole minutes, at least 1; null before it started. */
export function stepMinutes(state: { status: string; startedAt?: string | null; finishedAt?: string | null }, now: Date): number | null {
  if (!state.startedAt) return null;
  const end = state.finishedAt ? new Date(state.finishedAt) : state.status === "running" || state.status === "asking" ? now : null;
  if (!end) return null;
  return Math.max(1, Math.round((end.getTime() - new Date(state.startedAt).getTime()) / 60_000));
}

export type FeedKind = "note" | "look" | "mark" | "product" | "page" | "legal" | "goal";
export type FeedItem = { at: string; kind: FeedKind; label: string };

/** The newest things made, newest first, at most `max`. */
export function latestMade(items: readonly FeedItem[], max = 8): FeedItem[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

/** How long ago, for the feed: "now", minutes, hours. */
export function agoMinutes(at: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
}

/** A source's site as the owner reads it: `www.example.com/x` is `example.com`; anything that is not an address is left out. */
export function siteOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** A colour safe to put in a style: a hex colour, else the fallback. */
export function safeColour(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value.trim()) ? value.trim() : fallback;
}

/** A font family safe to put in a style (letters, digits, spaces and hyphens), quoted, with a generic family after it. */
export function safeFont(family: unknown, generic: "serif" | "sans-serif" = "sans-serif"): string {
  return typeof family === "string" && /^[\p{L}\p{N} -]{1,60}$/u.test(family.trim()) ? `"${family.trim()}", ${generic}` : generic;
}

/** The mock-up's colours: the look's light palette where it has one, else neutral greys while the brand is still being made. */
export type MockColours = { background: string; surface: string; text: string; muted: string; border: string; accent: string; accentText: string };

export const MOCK_GREYS: MockColours = {
  background: "#ffffff",
  surface: "#f3f4f6",
  text: "#1f2937",
  muted: "#6b7280",
  border: "#e5e7eb",
  accent: "#9ca3af",
  accentText: "#ffffff",
};

export function mockColours(palette: Partial<Record<keyof MockColours, unknown>> | null): MockColours {
  if (!palette) return MOCK_GREYS;
  return {
    background: safeColour(palette.background, MOCK_GREYS.background),
    surface: safeColour(palette.surface, MOCK_GREYS.surface),
    text: safeColour(palette.text, MOCK_GREYS.text),
    muted: safeColour(palette.muted, MOCK_GREYS.muted),
    border: safeColour(palette.border, MOCK_GREYS.border),
    accent: safeColour(palette.accent, MOCK_GREYS.accent),
    accentText: safeColour(palette.accentText, MOCK_GREYS.accentText),
  };
}
