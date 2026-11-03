import { localNow } from "./staff-alerts";
import { isHandWrittenOnly } from "./ui-catalog";

/**
 * New interface text reaches the machine-translated languages by itself (D436): once a night the platform's AI translates, for each
 * language that is switched on, not written by hand and already has interface text (a platform admin translated it on Platform →
 * Languages), the catalogue's texts it has none for yet, kept as drafts to review as *Translate* keeps them. Never a text that has one
 * (no re-translation, nothing a person wrote) and never a hand-written-only one. Pure: when a night's run may start, how much it may do
 * and in what order; the run is `src/server/ui-nightly.ts`.
 */

/** The platform's clock: Kaizena Flow keeps Oslo time, as on its own pages. */
export const UI_NIGHT_TIME_ZONE = "Europe/Oslo";

/** The hour from which a day's run may start: the first run of the five-minute dispatcher at or after 02:00 Oslo time, once a day. */
export const UI_NIGHT_HOUR = 2;

/**
 * The most texts one language gets in a night. The catalogue holds about 1,700 texts and a day's work adds a few dozen (the whole of
 * D431, request a quote, about 40), so 300 keeps a translated language current after the busiest day, while a night's cost stays
 * bounded at about eight calls of 40 texts a language; a longer backlog catches up over a few nights, or at once with *Translate*.
 */
export const UI_NIGHT_KEYS_PER_LANGUAGE = 300;

/** Texts sent in one call, as *Translate* on a language's page sends them. */
export const UI_NIGHT_CHUNK = 40;

/**
 * How long a night's run starts new calls. The five-minute dispatcher has 300 seconds and runs its jobs side by side; a call may take
 * up to 90 seconds more, so after two minutes the rest waits for the next night.
 */
export const UI_NIGHT_BUDGET_MS = 120_000;

/** The day (`YYYY-MM-DD`, Oslo) whose run may start at `now`, or null before the night's hour. */
export function nightDay(now: Date, fromHour: number = UI_NIGHT_HOUR): string | null {
  const local = localNow(now, UI_NIGHT_TIME_ZONE);
  return local.hour >= fromHour ? local.date : null;
}

/**
 * What a night translates: each language's missing texts, never a hand-written-only one, up to `cap`; the languages with the fewest
 * missing first, so those kept current stay current and a long backlog takes the time that is left. A language with nothing to do
 * is left out.
 */
export function nightPlan<L extends { lang: string; missing: readonly string[] }>(languages: readonly L[], cap: number = UI_NIGHT_KEYS_PER_LANGUAGE): (L & { keys: string[] })[] {
  return languages
    .map((language) => ({ ...language, keys: language.missing.filter((key) => !isHandWrittenOnly(key)).slice(0, Math.max(0, cap)) }))
    .filter((language) => language.keys.length > 0)
    .sort((a, b) => a.missing.length - b.missing.length || a.lang.localeCompare(b.lang));
}

/** Texts in the groups one call takes. */
export function chunksOf<T>(items: readonly T[], size: number = UI_NIGHT_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) chunks.push(items.slice(i, i + Math.max(1, size)));
  return chunks;
}
