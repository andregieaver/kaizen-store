/**
 * Loyalty levels and the credit for opening an account (wave 11 unit M, D392): the bonus program's tiers, beside `bonus.ts`. A level is
 * reached by what a customer paid for goods in the last 365 days, less what was refunded, in the credits' currency (worked out by the
 * database, `commerce.bonus_level_spend()`, never here), and gives its own rate of credits back on the next paid order; the highest level
 * reached applies, never a sum. Pure and without zod, so the shopper's pages and the owner's form use it as the database decides it.
 */

/** At most this many levels above the program's own rate. */
export const BONUS_LEVELS_MAX = 4;
/** A level's name, as the customer reads it ("Gold"). */
export const BONUS_LEVEL_NAME_MAX = 40;
/** The most a customer can be given for opening an account, in minor units of the credits' currency. */
export const BONUS_SIGNUP_MAX_MINOR = 1_000_000;
/** The days of spending a level counts. */
export const BONUS_LEVEL_DAYS = 365;

export type BonusLevel = {
  name: string;
  /** Paid for goods in the last 365 days, less refunds, from which the level applies, in minor units of the credits' currency. */
  fromMinor: number;
  /** Credits back at this level, in basis points (500 is 5%). */
  earnBps: number;
};

/** The level a customer is at for what they spent, or null below the first (the program's own rate applies). */
export function levelFor(levels: readonly BonusLevel[], spentMinor: number): BonusLevel | null {
  let reached: BonusLevel | null = null;
  for (const level of levels) if (spentMinor >= level.fromMinor && (!reached || level.fromMinor > reached.fromMinor)) reached = level;
  return reached;
}

/** The rate a customer earns at: their level's, else the program's own. */
export function earnBpsFor(baseBps: number, levels: readonly BonusLevel[], spentMinor: number): number {
  return levelFor(levels, spentMinor)?.earnBps ?? baseBps;
}

/** The next level above what was spent and how much more it needs, or null at the top (or with no levels). */
export function nextLevel(levels: readonly BonusLevel[], spentMinor: number): { level: BonusLevel; remainingMinor: number } | null {
  const above = levels.filter((l) => l.fromMinor > spentMinor).sort((a, b) => a.fromMinor - b.fromMinor)[0];
  return above ? { level: above, remainingMinor: above.fromMinor - spentMinor } : null;
}

export type LevelProblem = "too_many" | "name" | "from" | "order" | "rate" | "rate_order";

/**
 * What is wrong with a set of levels: at most four, each named, each from more than the one before it, each giving more back than the
 * program's own rate and than the level below it (so a level is never a step down), at most the program's ceiling.
 */
export function levelsProblem(levels: readonly BonusLevel[], baseBps: number, maxBps: number): LevelProblem | null {
  if (levels.length > BONUS_LEVELS_MAX) return "too_many";
  let fromBefore = 0;
  let bpsBefore = baseBps;
  for (const level of levels) {
    const name = level.name.trim();
    if (name.length === 0 || name.length > BONUS_LEVEL_NAME_MAX) return "name";
    if (!Number.isSafeInteger(level.fromMinor) || level.fromMinor <= 0) return "from";
    if (level.fromMinor <= fromBefore) return "order";
    if (!Number.isInteger(level.earnBps) || level.earnBps > maxBps || level.earnBps <= 0) return "rate";
    if (level.earnBps <= bpsBefore) return "rate_order";
    fromBefore = level.fromMinor;
    bpsBefore = level.earnBps;
  }
  return null;
}

/** Levels as the database keeps them (`bonus_settings.levels`), read without trusting their shape: anything unreadable is left out. */
export function readLevels(raw: unknown): BonusLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { name, fromMinor, earnBps } = item as Record<string, unknown>;
      if (typeof name !== "string" || typeof fromMinor !== "number" || typeof earnBps !== "number") return [];
      return [{ name, fromMinor, earnBps }];
    })
    .slice(0, BONUS_LEVELS_MAX);
}
