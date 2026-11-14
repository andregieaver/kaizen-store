import { z } from "zod";

import type { AutonomyArea, AutonomyLevel, AutonomySettings } from "./autopilot-autonomy";

/**
 * Challenge mode (`docs/100-day-challenge.md` 4A1, 5): the 100-day challenge, where the autopilot runs a store alone and a person only
 * approves refunds and answers escalated support. A platform admin sets it on a store (`commerce.autopilot_settings.challenge`); while it is
 * on, the store's autonomy is the challenge's preset, the owner's settings are locked (only the emergency pause stays theirs, and pressing it
 * is an intervention), a step that fails three times is skipped instead of asking, and a few calls that otherwise always ask run within the
 * challenge's own budgets. Pure: the dates, the preset and the budgets; the server reads the row and the facts.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is YYYY-MM-DD.");

/** The longest run from Day 1 to the end, in days: the 100 days and the 30 after in which refunds settle. */
export const CHALLENGE_MAX_DAYS = 130;
/** The longest rehearsal before Day 1, in days. */
export const REHEARSAL_MAX_DAYS = 42;

export const challengeSchema = z
  .object({
    /** Challenge mode comes on: the rehearsal's first day, or Day 1 when there is none. */
    startsOn: day,
    /** Day 1: what the scoreboard counts from. */
    dayOne: day,
    /** The last day challenge mode is on. */
    endsOn: day,
    /** Broadcasts the autopilot may send itself in seven days (a broadcast otherwise always asks, D334). */
    broadcastsPerWeek: z.number().int().min(0).max(14).default(2),
    /** Answers to customers on the support desk the autopilot may send itself in 24 hours (instead of the weekly email budget). */
    supportRepliesPerDay: z.number().int().min(0).max(2000).default(200),
    /** The autopilot's AI cost a calendar month, in US dollars: sized from the rehearsal's cost (the plan says twice it). */
    aiMonthlyUsd: z.number().min(0).max(100_000).default(300),
    /** The largest change of a variant's price it may make itself, in percent. */
    priceChangePercent: z.number().int().min(0).max(100).default(15),
    /** The deepest discount or campaign it may make itself, in percent. */
    discountPercent: z.number().int().min(0).max(100).default(20),
    /** The largest raise of an ad budget it may make itself, in percent of today's daily budget. */
    adRaisePercent: z.number().int().min(0).max(1000).default(20),
    /** The lowest margin it may leave a product, in percent of the price without VAT (D5): the owner's, agreed before Day 1. */
    marginFloorPercent: z.number().min(0).max(95).default(10),
  })
  .superRefine((c, ctx) => {
    if (c.startsOn > c.dayOne) ctx.addIssue({ code: "custom", path: ["startsOn"], message: "Challenge mode starts on or before Day 1." });
    if (c.dayOne > c.endsOn) ctx.addIssue({ code: "custom", path: ["endsOn"], message: "The challenge ends after Day 1." });
    if (daysBetween(c.startsOn, c.dayOne) > REHEARSAL_MAX_DAYS) {
      ctx.addIssue({ code: "custom", path: ["startsOn"], message: `The rehearsal is at most ${REHEARSAL_MAX_DAYS} days.` });
    }
    if (daysBetween(c.dayOne, c.endsOn) + 1 > CHALLENGE_MAX_DAYS) {
      ctx.addIssue({ code: "custom", path: ["endsOn"], message: `The challenge lasts at most ${CHALLENGE_MAX_DAYS} days from Day 1.` });
    }
  });
export type Challenge = z.output<typeof challengeSchema>;

/** The challenge as the autonomy rules see it while it is on. */
export type ChallengeState = {
  active: true;
  dayOne: string;
  endsOn: string;
  /** Day 1 is 1; 0 or less in the rehearsal. */
  day: number;
  broadcastsPerWeek: number;
  supportRepliesPerDay: number;
};

/** A stored challenge, read safely: anything unreadable is no challenge. */
export function readChallenge(raw: unknown): Challenge | null {
  if (raw === null || raw === undefined) return null;
  const parsed = challengeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whole days from one date to another (both YYYY-MM-DD, read as UTC). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today's date in UTC, YYYY-MM-DD. */
export const utcDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** Whether challenge mode is on that day (from `startsOn` to `endsOn`, both included). */
export function challengeOn(c: Challenge | null, today: string): c is Challenge {
  return c !== null && c.startsOn <= today && today <= c.endsOn;
}

/** The challenge's day: Day 1 is 1, the day before it 0. */
export const challengeDay = (c: Challenge, today: string): number => daysBetween(c.dayOne, today) + 1;

/** The levels while challenge mode is on (`docs/100-day-challenge.md` 5). */
export const CHALLENGE_LEVELS: Readonly<Record<AutonomyArea, AutonomyLevel>> = {
  catalogue: "auto",
  website: "auto",
  marketing: "auto",
  messages: "auto",
  money: "auto",
  design: "tell",
  setup: "tell",
};

/** How it keeps working while challenge mode is on: plans start themselves, goals are looked at every three days, it reacts at once. */
export const CHALLENGE_PLANNING = {
  continues: true,
  starts: "auto",
  reviewDays: 3,
  plansPerWeek: 10,
  reacts: true,
  waitMinutes: 5,
} as const satisfies AutonomySettings["planning"];

/**
 * The settings in force: the owner's as stored, or, while challenge mode is on, the challenge's preset over them, with the state the rules
 * read. The owner's pause stays theirs: a paused store stays paused (and the challenge suspended) whatever the preset.
 */
export function withChallenge(settings: AutonomySettings, c: Challenge | null, today: string): AutonomySettings {
  if (!challengeOn(c, today)) return { ...settings, challenge: null };
  return {
    ...settings,
    levels: { ...CHALLENGE_LEVELS },
    planning: { ...CHALLENGE_PLANNING },
    budgets: {
      ...settings.budgets,
      aiMonthlyUsd: c.aiMonthlyUsd,
      priceChangePercent: c.priceChangePercent,
      discountPercent: c.discountPercent,
      adRaisePercent: c.adRaisePercent,
      marginFloorPercent: c.marginFloorPercent,
    },
    challenge: {
      active: true,
      dayOne: c.dayOne,
      endsOn: c.endsOn,
      day: challengeDay(c, today),
      broadcastsPerWeek: c.broadcastsPerWeek,
      supportRepliesPerDay: c.supportRepliesPerDay,
    },
  };
}

/** The words for a locked setting, naming the day it opens again. */
export const lockedWords = (c: { endsOn: string }): string =>
  `The autopilot's settings are locked for the challenge until ${c.endsOn}. Only the pause is yours, and pausing suspends the challenge.`;
