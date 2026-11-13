import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { readDb } from "@/db/client";
import { isBuiltIn } from "@/lib/built-in-languages";
import { enBrowser } from "@/lib/messages/en-browser";
import { enReturns } from "@/lib/messages/en-returns";
import { catalogOf, overlayMessages } from "@/lib/ui-catalog";
import { forgetMessages, registerMessages, registeredLanguages } from "@/lib/ui-registry";

import { log } from "./log";
import { textList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * The reader of the interface text of languages without hand-written text (D111): what is kept in `commerce.ui_translations`, read
 * into the registry that `t()` and `emailText()` use. An instance reads it at start with two statements, whatever the number of
 * languages (`startUi()`, from `src/instrumentation.ts`); a language is built when `t()` or `emailText()` first reads it; and the
 * one-row stamp `platform_settings.ui_text_version` is polled every ten minutes, only on an instance that was asked for a translated
 * language since the last tick. Pages are drawn from memory: the sync `t()` never waits on the database, and never reads it while a
 * page is prerendered. The tools that make the text are in `src/server/ui-text.ts`; the start hook and the pages import this file,
 * never that one (bloat review step 0.8).
 */

const KEY = "__kaizenUiState";

/** The keys a visitor's client components read (`en-browser.ts`) and the withdrawal page's own (`en-returns.ts`): all a document gets of a language (D212). */
export const BROWSER_KEYS = new Set(catalogOf("ui", enBrowser).map((e) => e.key));
export const RETURNS_KEYS = new Set(catalogOf("ui", { returns: enReturns }).map((e) => e.key));

/** How long an instance goes between looks at the version stamp. */
export const POLL_MS = 600_000;

type State = {
  loaded: boolean;
  checkedAt: number;
  /** The platform's `ui_text_version` as last read. */
  stamp: string | null;
  /** A translated language was asked for since the last tick (`uiTextsFor()`, `returnsTextsFor()`). */
  used: boolean;
  inflight: Promise<void> | null;
  versions: Map<string, string>;
  /** The texts the browser's components read, by language (`UiTexts`, `uiTextsFor()`). */
  browser: Map<string, Record<string, string>>;
  /** The withdrawal page's texts, by language (`returnsTextsFor()`). */
  returns: Map<string, Record<string, string>>;
};

function state(): State {
  const scope = globalThis as unknown as Record<string, State | undefined>;
  return (scope[KEY] ??= { loaded: false, checkedAt: 0, stamp: null, used: false, inflight: null, versions: new Map(), browser: new Map(), returns: new Map() });
}

/** Reads the given languages with one statement and registers makers for them; nothing is built until `t()` or `emailText()` reads a language. */
async function loadLanguages(langs: string[]): Promise<void> {
  if (langs.length === 0) return;
  const [{ t }, { emailText }] = await Promise.all([import("@/lib/i18n"), import("@/lib/email-text")]);
  const english = { ui: t("en"), email: emailText("en") };
  const rows = await typedRows(
    z.object({ lang: col.text, key: col.text, text: col.text }),
    sql`select lang, key, text from commerce.ui_translations where lang = any(${textList(langs)})`,
    readDb(),
  );
  const byLang = new Map<string, { ui: Map<string, string>; email: Map<string, string> }>(langs.map((lang) => [lang, { ui: new Map(), email: new Map() }]));
  for (const row of rows) {
    const texts = byLang.get(String(row.lang));
    if (texts) (String(row.key).startsWith("email:") ? texts.email : texts.ui).set(String(row.key), String(row.text));
  }
  for (const [lang, { ui, email }] of byLang) {
    const pick = (keys: Set<string>) => Object.fromEntries([...ui].filter(([key]) => keys.has(key)));
    const returns = pick(RETURNS_KEYS);
    registerMessages(lang, {
      makeUi: () => overlayMessages("ui", english.ui, ui, lang),
      makeEmail: () => overlayMessages("email", english.email, email, lang),
      texts: returns,
    });
    state().browser.set(lang, pick(BROWSER_KEYS));
    state().returns.set(lang, returns);
  }
}

/** Reads the version stamp and the languages' versions with one statement, then the languages that changed with a second; a failure leaves what there is (English where nothing is). */
async function refresh(): Promise<void> {
  const s = state();
  try {
    const rows = await typedRows(
      z.object({ stamp: col.text, lang: col.textOrNull, n: col.int.nullable(), v: col.textOrNull }),
      sql`
        select p.stamp, v.lang, v.n, v.v
        from (select coalesce((select ui_text_version from commerce.platform_settings), 0)::text as stamp) p
        left join lateral (
          select lang, count(*)::int as n, max(updated_at)::text as v from commerce.ui_translations group by lang
        ) v on true
      `,
      readDb(),
    );
    const seen = new Set<string>();
    const changed: string[] = [];
    const versions = new Map<string, string>();
    for (const row of rows) {
      if (row.lang === null) continue;
      const lang = String(row.lang);
      const version = `${row.n}:${row.v}`;
      seen.add(lang);
      if (isBuiltIn(lang)) continue;
      versions.set(lang, version);
      if (s.versions.get(lang) !== version) changed.push(lang);
    }
    await loadLanguages(changed);
    for (const lang of changed) s.versions.set(lang, versions.get(lang)!);
    for (const lang of registeredLanguages()) {
      if (!seen.has(lang)) {
        forgetMessages(lang);
        s.versions.delete(lang);
        s.browser.delete(lang);
        s.returns.delete(lang);
      }
    }
    s.stamp = rows[0] ? String(rows[0].stamp) : s.stamp;
  } catch (error) {
    log("warn", "ui_text.read_failed", {}, error);
  } finally {
    s.loaded = true;
    s.checkedAt = Date.now();
    s.inflight = null;
  }
}

/** Looks at the one-row stamp; the languages are read again only when it moved. */
async function poll(): Promise<void> {
  const s = state();
  try {
    const rows = await typedRows(
      z.object({ stamp: col.text }),
      sql`select coalesce((select ui_text_version from commerce.platform_settings), 0)::text as stamp`,
      readDb(),
    );
    if (rows[0] && String(rows[0].stamp) === s.stamp) {
      s.checkedAt = Date.now();
      s.inflight = null;
      return;
    }
  } catch (error) {
    log("warn", "ui_text.read_failed", {}, error);
    s.checkedAt = Date.now();
    s.inflight = null;
    return;
  }
  await refresh();
}

/**
 * Makes sure the languages' text is read: the first call waits for it, later
 * ones return at once and, every ten minutes, look at the version stamp in the background.
 */
export async function ensureUi(): Promise<void> {
  const s = state();
  if (!s.loaded) {
    await (s.inflight ??= refresh());
    return;
  }
  if (!s.inflight && Date.now() - s.checkedAt > POLL_MS) s.inflight = poll();
}

/**
 * Keeps the text current in a long-lived server: the first read waits, then a
 * timer looks at the stamp every ten minutes, only if a translated language was
 * asked for since the last tick (pages are drawn from memory, never waiting on
 * the database). Called once when the instance starts.
 */
export async function startUi(): Promise<void> {
  const s = state();
  await ensureUi();
  if ((globalThis as Record<string, unknown>).__kaizenUiTimer) return;
  const tick = () => {
    try {
      if (s.used && !s.inflight) {
        s.used = false;
        s.inflight = poll();
      }
    } catch (error) {
      log("warn", "ui_text.read_failed", {}, error);
    }
    const timer = setTimeout(tick, POLL_MS);
    timer.unref?.();
    (globalThis as Record<string, unknown>).__kaizenUiTimer = timer;
  };
  const timer = setTimeout(tick, POLL_MS);
  timer.unref?.();
  (globalThis as Record<string, unknown>).__kaizenUiTimer = timer;
}

/** Reads a language again now, after the platform admin changed it. */
export async function reloadUi(lang: string): Promise<void> {
  const s = state();
  await loadLanguages([lang]);
  s.versions.delete(lang);
  // Other instances notice within ten minutes, where they serve a translated language.
  s.checkedAt = 0;
}

/** The texts a visitor's browser reads, for a language translated by AI; null for a language written by hand or not translated. */
export function uiTextsFor(lang: string): Record<string, string> | null {
  if (isBuiltIn(lang)) return null;
  state().used = true;
  return state().browser.get(lang) ?? null;
}

/** The withdrawal page's own texts, with the same null rule: memory only, so a page may call it while it renders. */
export function returnsTextsFor(lang: string): Record<string, string> | null {
  if (isBuiltIn(lang)) return null;
  state().used = true;
  return state().returns.get(lang) ?? null;
}
