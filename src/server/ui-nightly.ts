import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { BUILT_IN_LANGUAGES } from "@/lib/ui-catalog-all";
import { chunksOf, nightDay, nightPlan, UI_NIGHT_BUDGET_MS, UI_NIGHT_TIME_ZONE } from "@/lib/ui-nightly";

import type { AiConnection } from "./ai";
import { skipWhilePaused } from "./ai-pause";
import { claimDay, tracked } from "./cron-runs";
import { log } from "./log";
import { textList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";
import { generateChunk, planGeneration, uiConnection } from "./ui-text";

/**
 * New interface text reaches the machine-translated languages by itself (D436). Each night, from the five-minute dispatcher, the
 * platform's AI (`ui_translation`, Kaizena Flow's own key) translates the texts each kept-up language has none for yet: a language
 * switched on, not written by hand, that already has interface text, which a platform admin gave it with *Translate* on Platform →
 * Languages (a language nobody translated stays English until someone does, so nothing is spent on languages no one chose). Only
 * missing texts (`planGeneration(lang, "missing")`, and `missingOnly` again when the answer is kept): never a text that has one, never
 * what a person wrote, never a hand-written-only one (the catalogue leaves those out). At most `UI_NIGHT_KEYS_PER_LANGUAGE` a language
 * and `UI_NIGHT_BUDGET_MS` of calls a night; kept as unreviewed AI drafts and audited as *Translate* is (`generateChunk()`, with no
 * account). The day is claimed in the ledger (`claimDay()`) and the run kept as `daily.ui-translations`.
 */

/** The night's run in `commerce.cron_jobs` (the dispatcher's own five-minute row is `dispatcher.ui-translations`). */
export const UI_NIGHT_JOB = "daily.ui-translations";

/** Why a run translated nothing: before the night's hour, already run today, AI that acts on its own paused, no kept-up language, no AI, nothing missing. */
export type NightSkip = "not_yet" | "done_today" | "paused" | "no_language" | "no_ai" | "nothing_missing";

/** One language's night: texts it lacked, texts sent, texts kept, texts the checks refused, and whether the AI failed it. */
export type NightLanguage = { lang: string; missing: number; sent: number; saved: number; refused: number; failed: boolean };

export type NightResult = { skipped: NightSkip | null; languages: NightLanguage[]; outOfTime: boolean };

export type NightDeps = {
  now?: Date;
  /** The hour the night begins, for a test (`UI_NIGHT_HOUR`). */
  fromHour?: number;
  cap?: number;
  budgetMs?: number;
  clock?: () => number;
  /** The AI to use, for a test; read from the platform's settings when left out. */
  connection?: AiConnection | null;
};

const skipped = (reason: NightSkip): NightResult => ({ skipped: reason, languages: [], outOfTime: false });

/** The languages the night keeps up: switched on, not written by hand, with interface text already. */
export async function keptUpLanguages(): Promise<{ lang: string; name: string }[]> {
  return typedRows(
    z.object({ lang: col.text, name: col.text }),
    sql`
      select p.lang, p.name from commerce.platform_languages p
      where p.enabled and not (p.lang = any(${textList(BUILT_IN_LANGUAGES)}))
        and exists (select 1 from commerce.ui_translations u where u.lang = p.lang)
      order by p.lang`,
  );
}

/**
 * The five-minute dispatcher's job: before 02:00 Oslo time, or once today's run is claimed, it does nothing; the first run after
 * claims the day and translates (`translateNight()`, tracked as `daily.ui-translations`). Null when that run threw (logged and kept).
 */
export async function runNightlyUiTranslations(deps: NightDeps = {}): Promise<NightResult | null> {
  const now = deps.now ?? new Date();
  const day = nightDay(now, deps.fromHour);
  if (!day) return skipped("not_yet");
  // The job's name is written out in both calls, so `cron-routes.scan.test.ts` finds it and holds the claim and the run to one name.
  if (!(await claimDay("daily.ui-translations", day, UI_NIGHT_TIME_ZONE, now))) return skipped("done_today");
  return tracked("daily.ui-translations", 86_400, () => translateNight(deps));
}

/** One night's translating, as described above. Says in its answer, and in one log line, why it did nothing. */
export async function translateNight(deps: NightDeps = {}): Promise<NightResult> {
  // AI no person started: it waits while a platform admin has paused AI that acts on its own (PSI AST-07).
  if (await skipWhilePaused("ui_translations")) return skipped("paused");
  const languages = await keptUpLanguages();
  if (languages.length === 0) {
    log("info", "ui.nightly_skipped", { reason: "no_language" });
    return skipped("no_language");
  }
  const connection = deps.connection !== undefined ? deps.connection : await uiConnection(null);
  if (!connection?.textModel) {
    log("info", "ui.nightly_skipped", { reason: "no_ai", languages: languages.length });
    return skipped("no_ai");
  }
  const plan = nightPlan(await Promise.all(languages.map(async (language) => ({ ...language, missing: await planGeneration(language.lang, "missing") }))), deps.cap);
  if (plan.length === 0) {
    log("info", "ui.nightly_skipped", { reason: "nothing_missing", languages: languages.length });
    return skipped("nothing_missing");
  }

  const clock = deps.clock ?? Date.now;
  const budget = deps.budgetMs ?? UI_NIGHT_BUDGET_MS;
  const started = clock();
  const done: NightLanguage[] = [];
  let outOfTime = false;
  for (const language of plan) {
    const night: NightLanguage = { lang: language.lang, missing: language.missing.length, sent: 0, saved: 0, refused: 0, failed: false };
    for (const keys of chunksOf(language.keys)) {
      if (clock() - started >= budget) {
        outOfTime = true;
        break;
      }
      const result = await generateChunk(connection, { accountId: null }, { lang: language.lang, name: language.name }, keys, { missingOnly: true });
      night.sent += keys.length;
      if (!result.ok) {
        // The AI did not answer: this language waits for the next night, the others are still tried.
        night.failed = true;
        break;
      }
      night.saved += result.saved;
      night.refused += result.problems.length;
    }
    if (night.sent > 0) {
      done.push(night);
      log(night.failed ? "warn" : "info", "ui.nightly_translated", { ...night });
    }
    if (outOfTime) break;
  }
  log("info", "ui.nightly_done", {
    languages: plan.length,
    reached: done.length,
    saved: done.reduce((n, l) => n + l.saved, 0),
    failed: done.filter((l) => l.failed).length,
    outOfTime,
  });
  return { skipped: null, languages: done, outOfTime };
}
