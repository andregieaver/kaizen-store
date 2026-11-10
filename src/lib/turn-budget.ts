/**
 * What one turn of the AI manager may spend (code review step 0.8, findings FA2 and FA5): a deadline and a ceiling of tokens. Pure, so
 * the loop in `runTurn()` (`src/server/owner-assistant.ts`) asks it before every round and every tool, and a test can hold it to its
 * word without a model.
 *
 * The deadline sits inside the route's own limit (`maxDuration` 300 s), so a turn always ends on its own: with time short, the model is
 * given no tools and must answer from what it has, and that answer and the tools that ran are kept. A turn that passes its ceiling of
 * tokens stops with a plain message instead of going round again.
 */

/** A turn's time, from its first round: well inside the route's 300 s, leaving room to save the answer. */
export const TURN_DEADLINE_MS = 240_000;
/** Time kept for the last, tool-free round: once less than this is left, the model answers now. */
export const LAST_ROUND_MS = 45_000;
/** The longest one round of the model may take. */
export const ROUND_TIMEOUT_MS = 60_000;
/** Below this, no round is started at all: it could not finish. */
const TOO_LATE_MS = 5_000;
/**
 * Tokens one turn may use, in and out, over all its rounds. Eleven rounds of a full tool list and a long history come to about this;
 * an ordinary question uses a tenth of it. Past it, the turn stops rather than going round again.
 */
export const TURN_TOKENS_MAX = 400_000;
/**
 * What the AI manager may cost one platform admin in a day (store null), in millionths of a dollar: a store's turns are held by its
 * plan's monthly allowance, the platform's had no limit (FA5).
 */
export const PLATFORM_DAILY_COST_MICROS = 25_000_000;

export type TurnLimits = { deadlineMs: number; lastRoundMs: number; tokens: number };
export const TURN_LIMITS: TurnLimits = { deadlineMs: TURN_DEADLINE_MS, lastRoundMs: LAST_ROUND_MS, tokens: TURN_TOKENS_MAX };

/** Why a turn ended before the model answered. */
export type TurnStop = "time" | "tokens" | "allowance" | "platform_cost";

/** The next round: with tools, the last one without, or none. */
export type RoundPlan = { kind: "tools"; timeoutMs: number } | { kind: "last"; timeoutMs: number } | { kind: "stop"; reason: TurnStop };

/**
 * The round to run now. `step` counts from 0; at `maxSteps` the model answers without tools whatever the time. A round with tools may
 * take what is left less the last round's share, so the last round always has its time.
 */
export function nextRound(input: { step: number; maxSteps: number; now: number; deadline: number; tokens: number; limits?: TurnLimits }): RoundPlan {
  const limits = input.limits ?? TURN_LIMITS;
  if (input.tokens >= limits.tokens) return { kind: "stop", reason: "tokens" };
  const left = input.deadline - input.now;
  if (left < Math.min(TOO_LATE_MS, limits.lastRoundMs / 4)) return { kind: "stop", reason: "time" };
  const timeoutMs = Math.min(ROUND_TIMEOUT_MS, left);
  if (input.step >= input.maxSteps || left <= limits.lastRoundMs) return { kind: "last", timeoutMs };
  return { kind: "tools", timeoutMs: Math.min(ROUND_TIMEOUT_MS, left - limits.lastRoundMs) };
}

/** Whether a tool the model asked for may still run: not once the last round's time has begun. */
export const toolMayRun = (now: number, deadline: number, limits: TurnLimits = TURN_LIMITS) => deadline - now > limits.lastRoundMs;

/** What the person reads when a turn ends early; the tools that ran are kept with it. */
export const TURN_STOP_WORDS: Record<TurnStop, string> = {
  time: "This took longer than one turn allows, so I stopped here. What I did so far is listed below; ask again to go on.",
  tokens: "This took more work than one turn allows, so I stopped here. What I did so far is listed below; ask again, perhaps in smaller parts, to go on.",
  allowance: "This store's AI for the month is used up, so I stopped here. What I did so far is listed below.",
  platform_cost: "You have reached today's limit for the AI manager on the platform. It is back tomorrow.",
};

/** The message for a tool that was asked for but not run, because the turn's time was up. */
export const TOOL_OUT_OF_TIME = "Not run: the turn ran out of time. Answer from what you have, and say what is left to do.";
