import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { emailText } from "@/lib/email-text";
import { t } from "@/lib/i18n";
import { forgetMessages, registerMessages, registeredLanguages } from "@/lib/ui-registry";
import { overlayMessages, sourceHash } from "@/lib/ui-catalog";
import { catalogEntry, fullCatalog, isBuiltIn } from "@/lib/ui-catalog-all";
import { batchEntries, entryProblem, readUiAnswer, uiMessages } from "@/lib/ui-translate";
import { parseModelJson } from "@/lib/query-understanding";

import { AiError, aiFor, completeText, type AiConnection } from "./ai";
import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * The interface text of languages without hand-written text (D111): what is
 * kept in `commerce.ui_translations`, read into the registry that `t()` and
 * `emailText()` use, and the platform admin's tools to make it: translating
 * with AI, a person's edits, and marking it reviewed. The server reads it when
 * an instance starts and looks for changes each minute (`startUi()`, from
 * `src/instrumentation.ts`), and pages are drawn from memory: the sync `t()`
 * never waits on the database, and never reads it while a page is prerendered.
 */

const KEY = "__kaizenUiState";
/** How long a server instance trusts what it has read before asking whether a language changed. */
const FRESH_MS = 60_000;

type State = {
  loaded: boolean;
  checkedAt: number;
  inflight: Promise<void> | null;
  versions: Map<string, string>;
  /** The storefront's texts by language, for the browser (`UiProvider`). */
  texts: Map<string, Record<string, string>>;
};

function state(): State {
  const scope = globalThis as unknown as Record<string, State | undefined>;
  return (scope[KEY] ??= { loaded: false, checkedAt: 0, inflight: null, versions: new Map(), texts: new Map() });
}

async function loadLanguage(lang: string): Promise<void> {
  const rows = await readDb().execute<Row>(sql`select key, text from commerce.ui_translations where lang = ${lang}`);
  const ui = new Map<string, string>();
  const email = new Map<string, string>();
  for (const row of rows) (String(row.key).startsWith("email:") ? email : ui).set(String(row.key), String(row.text));
  registerMessages(lang, { ui: overlayMessages("ui", t("en"), ui, lang), email: overlayMessages("email", emailText("en"), email, lang) });
  state().texts.set(lang, Object.fromEntries(ui));
}

/** Reads the languages that changed since last time; a failure leaves what there is (English where nothing is). */
async function refresh(): Promise<void> {
  const s = state();
  try {
    const rows = await readDb().execute<Row>(sql`
      select lang, count(*)::int as n, max(updated_at)::text as v from commerce.ui_translations group by lang
    `);
    const seen = new Set<string>();
    for (const row of rows) {
      const lang = String(row.lang);
      const version = `${row.n}:${row.v}`;
      seen.add(lang);
      if (s.versions.get(lang) === version || isBuiltIn(lang)) continue;
      await loadLanguage(lang);
      s.versions.set(lang, version);
    }
    for (const lang of registeredLanguages()) {
      if (!seen.has(lang)) {
        forgetMessages(lang);
        s.versions.delete(lang);
        s.texts.delete(lang);
      }
    }
  } catch (error) {
    console.warn("Interface text could not be read:", error instanceof Error ? error.message : error);
  } finally {
    s.loaded = true;
    s.checkedAt = Date.now();
    s.inflight = null;
  }
}

/**
 * Makes sure the languages' text is read: the first call waits for it, later
 * ones return at once and, once a minute, look for changes in the background.
 */
export async function ensureUi(): Promise<void> {
  const s = state();
  if (!s.loaded) {
    await (s.inflight ??= refresh());
    return;
  }
  if (!s.inflight && Date.now() - s.checkedAt > FRESH_MS) s.inflight = refresh();
}

/**
 * Keeps the text current in a long-lived server: the first read waits, then a
 * timer looks for changes each minute (pages are drawn from memory, never
 * waiting on the database). Called once when the instance starts.
 */
export async function startUi(): Promise<void> {
  const s = state();
  await ensureUi();
  if ((globalThis as Record<string, unknown>).__kaizenUiTimer) return;
  const timer = setInterval(() => {
    if (!s.inflight) s.inflight = refresh();
  }, FRESH_MS);
  timer.unref?.();
  (globalThis as Record<string, unknown>).__kaizenUiTimer = timer;
}

/** Reads a language again now, after the platform admin changed it. */
export async function reloadUi(lang: string): Promise<void> {
  const s = state();
  await loadLanguage(lang);
  s.versions.delete(lang);
  // Other instances notice within a minute.
  s.checkedAt = 0;
}

/** The storefront's texts for a language, for the browser; null for a language written by hand or not translated. */
export function uiTextsFor(lang: string): Record<string, string> | null {
  return isBuiltIn(lang) ? null : (state().texts.get(lang) ?? null);
}

// ---------------------------------------------------------------------------
// What a language has
// ---------------------------------------------------------------------------

export type UiRow = { key: string; text: string; sourceHash: string; origin: "ai" | "staff"; reviewed: boolean };

export type UiCoverage = {
  total: number;
  translated: number;
  /** Translated from an English text that has changed since. */
  stale: number;
  reviewed: number;
};

/** How much of the catalogue a language has, for each language that has some. */
export async function uiCoverage(): Promise<Record<string, UiCoverage>> {
  const rows = await db().execute<Row>(sql`select lang, key, source_hash, reviewed_at is not null as reviewed from commerce.ui_translations`);
  const total = fullCatalog().length;
  const out: Record<string, UiCoverage> = {};
  for (const row of rows) {
    const entry = catalogEntry(String(row.key));
    if (!entry) continue;
    const c = (out[String(row.lang)] ??= { total, translated: 0, stale: 0, reviewed: 0 });
    c.translated += 1;
    if (String(row.source_hash) !== sourceHash(entry.source)) c.stale += 1;
    if (row.reviewed) c.reviewed += 1;
  }
  return out;
}

/** How many texts each language has and how many a person has read, cheaply: for the pages that only say where a language stands. */
export async function uiCounts(): Promise<Record<string, { translated: number; reviewed: number }>> {
  const rows = await readDb().execute<Row>(sql`
    select lang, count(*)::int as translated, count(reviewed_at)::int as reviewed from commerce.ui_translations group by lang
  `);
  return Object.fromEntries(rows.map((row) => [String(row.lang), { translated: Number(row.translated), reviewed: Number(row.reviewed) }]));
}

/** A language's rows, by key. */
export async function uiRows(lang: string): Promise<Map<string, UiRow>> {
  const rows = await db().execute<Row>(sql`
    select key, text, source_hash, origin, reviewed_at is not null as reviewed from commerce.ui_translations where lang = ${lang}
  `);
  return new Map(
    rows.map((row) => [
      String(row.key),
      { key: String(row.key), text: String(row.text), sourceHash: String(row.source_hash), origin: row.origin === "staff" ? "staff" : "ai", reviewed: Boolean(row.reviewed) } as UiRow,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Making it
// ---------------------------------------------------------------------------

export type GenerateMode = "missing" | "stale" | "all";

/**
 * The keys to translate: what has no text, what was translated from an English
 * text that has changed, or every one the AI wrote (everything again). What a
 * person wrote or edited is never replaced by the AI.
 */
export async function planGeneration(lang: string, mode: GenerateMode): Promise<string[]> {
  const have = await uiRows(lang);
  return fullCatalog()
    .filter((entry) => {
      const row = have.get(entry.key);
      if (!row) return true;
      if (row.origin === "staff") return false;
      return mode === "all" || (mode === "stale" && row.sourceHash !== sourceHash(entry.source));
    })
    .map((entry) => entry.key);
}

export type ChunkResult = { ok: true; saved: number; problems: { key: string; problem: string }[] } | { ok: false; problem: string };

async function saveRows(lang: string, rows: { key: string; text: string; origin: "ai" | "staff"; reviewed: boolean }[]): Promise<void> {
  for (const row of rows) {
    const entry = catalogEntry(row.key)!;
    await db().execute(sql`
      insert into commerce.ui_translations (lang, key, text, source_hash, origin, reviewed_at)
      values (${lang}, ${row.key}, ${row.text}, ${sourceHash(entry.source)}, ${row.origin}, ${row.reviewed ? sql`now()` : sql`null`})
      on conflict (lang, key) do update set
        text = excluded.text, source_hash = excluded.source_hash, origin = excluded.origin,
        reviewed_at = excluded.reviewed_at, updated_at = now()
    `);
  }
}

/** Translates some keys with the platform's AI and keeps what passes the checks, as a draft to review. */
export async function generateChunk(
  connection: AiConnection,
  who: { accountId: string },
  language: { lang: string; name: string },
  keys: string[],
): Promise<ChunkResult> {
  if (!connection.textModel) return { ok: false, problem: "No text model is set." };
  if (isBuiltIn(language.lang)) return { ok: false, problem: "This language is written by hand." };
  const entries = keys.flatMap((key) => {
    const entry = catalogEntry(key);
    return entry ? [entry] : [];
  });
  let saved = 0;
  const problems: { key: string; problem: string }[] = [];
  let failure: AiError | null = null;
  for (const batch of batchEntries(entries)) {
    try {
      const reply = await completeText(connection, uiMessages(language, batch), { maxTokens: 8000, timeoutMs: 90_000, temperature: 0.2, reasoningEffort: "low" });
      const read = readUiAnswer(parseModelJson(reply.text), batch, language.lang);
      // A person's edits are never replaced.
      const have = await uiRows(language.lang);
      const rows = [...read.done].filter(([key]) => have.get(key)?.origin !== "staff").map(([key, text]) => ({ key, text, origin: "ai" as const, reviewed: false }));
      await saveRows(language.lang, rows);
      saved += rows.length;
      problems.push(...read.problems);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      failure = error;
      problems.push(...batch.map((entry) => ({ key: entry.key, problem: "The AI did not answer." })));
    }
  }
  if (saved === 0 && failure) return { ok: false, problem: failure.message };
  if (saved > 0) {
    await audit(who.accountId, null, "language.ui_generated", { lang: language.lang, saved, model: connection.textModel, source: connection.source });
    await reloadUi(language.lang);
  }
  return { ok: true, saved, problems };
}

/** The platform's AI for translating the interface (Kaizen's own, never a store's). */
export async function uiConnection(accountId: string): Promise<AiConnection | null> {
  return aiFor(null, { feature: "ui_translation", accountId });
}

export type EditResult = { ok: true; saved: number } | { ok: false; problems: { key: string; problem: string }[] };

/** A person's own texts: each is checked as the AI's are, and kept as reviewed. */
export async function saveUiEdits(accountId: string, lang: string, edits: { key: string; text: string }[]): Promise<EditResult> {
  const problems: { key: string; problem: string }[] = [];
  const rows: { key: string; text: string; origin: "staff"; reviewed: true }[] = [];
  for (const { key, text } of edits) {
    const entry = catalogEntry(key);
    if (!entry) {
      problems.push({ key, problem: "Unknown text." });
      continue;
    }
    const problem = entryProblem(entry, text, lang);
    if (problem) problems.push({ key, problem });
    else rows.push({ key, text: text.trim(), origin: "staff", reviewed: true });
  }
  if (problems.length > 0) return { ok: false, problems };
  await saveRows(lang, rows);
  await audit(accountId, null, "language.ui_edited", { lang, count: rows.length });
  await reloadUi(lang);
  return { ok: true, saved: rows.length };
}

/** Marks a person as having read texts: the given keys, or all that are not yet. */
export async function markUiReviewed(accountId: string, lang: string, keys: string[] | null): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.ui_translations set reviewed_at = now()
    where lang = ${lang} and reviewed_at is null ${keys ? sql`and key = any(${sql`array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`})` : sql``}
    returning key
  `);
  await audit(accountId, null, "language.ui_reviewed", { lang, count: rows.length });
  return rows.length;
}

/** Deletes a language's texts, to start again. */
export async function clearUiTexts(accountId: string, lang: string): Promise<number> {
  const rows = await db().execute<Row>(sql`delete from commerce.ui_translations where lang = ${lang} returning key`);
  await audit(accountId, null, "language.ui_cleared", { lang, count: rows.length });
  await reloadUi(lang);
  return rows.length;
}
