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
import { col, typedRows } from "./typed-rows";

/**
 * The reader of the interface text of languages without hand-written text (D111): what is kept in `commerce.ui_translations`, read
 * into the registry that `t()` and `emailText()` use. The server reads it when an instance starts and looks for changes each minute
 * (`startUi()`, from `src/instrumentation.ts`), and pages are drawn from memory: the sync `t()` never waits on the database, and
 * never reads it while a page is prerendered. The tools that make the text are in `src/server/ui-text.ts`; the start hook and the
 * pages import this file, never that one (bloat review step 0.8).
 */

const KEY = "__kaizenUiState";

/** The keys a visitor's client components read (`en-browser.ts`) and the withdrawal page's own (`en-returns.ts`): all a document gets of a language (D212). */
export const BROWSER_KEYS = new Set(catalogOf("ui", enBrowser).map((e) => e.key));
export const RETURNS_KEYS = new Set(catalogOf("ui", { returns: enReturns }).map((e) => e.key));

/** How long a server instance trusts what it has read before asking whether a language changed. */
const FRESH_MS = 60_000;

type State = {
  loaded: boolean;
  checkedAt: number;
  inflight: Promise<void> | null;
  versions: Map<string, string>;
  /** The texts the browser's components read, by language (`UiTexts`, `uiTextsFor()`). */
  browser: Map<string, Record<string, string>>;
  /** The withdrawal page's texts, by language (`returnsTextsFor()`). */
  returns: Map<string, Record<string, string>>;
};

function state(): State {
  const scope = globalThis as unknown as Record<string, State | undefined>;
  return (scope[KEY] ??= { loaded: false, checkedAt: 0, inflight: null, versions: new Map(), browser: new Map(), returns: new Map() });
}

async function loadLanguage(lang: string): Promise<void> {
  const [{ t }, { emailText }] = await Promise.all([import("@/lib/i18n"), import("@/lib/email-text")]);
  const rows = await typedRows(z.object({ key: col.text, text: col.text }), sql`select key, text from commerce.ui_translations where lang = ${lang}`, readDb());
  const ui = new Map<string, string>();
  const email = new Map<string, string>();
  for (const row of rows) (String(row.key).startsWith("email:") ? email : ui).set(String(row.key), String(row.text));
  const pick = (keys: Set<string>) => Object.fromEntries([...ui].filter(([key]) => keys.has(key)));
  const browser = pick(BROWSER_KEYS);
  const returns = pick(RETURNS_KEYS);
  registerMessages(lang, { ui: overlayMessages("ui", t("en"), ui, lang), email: overlayMessages("email", emailText("en"), email, lang), texts: returns });
  state().browser.set(lang, browser);
  state().returns.set(lang, returns);
}

/** Reads the languages that changed since last time; a failure leaves what there is (English where nothing is). */
async function refresh(): Promise<void> {
  const s = state();
  try {
    const rows = await typedRows(
      z.object({ lang: col.text, n: col.int, v: col.text }),
      sql`select lang, count(*)::int as n, max(updated_at)::text as v from commerce.ui_translations group by lang`,
      readDb(),
    );
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
        s.browser.delete(lang);
        s.returns.delete(lang);
      }
    }
  } catch (error) {
    log("warn", "ui_text.read_failed", {}, error);
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

/** The texts a visitor's browser reads, for a language translated by AI; null for a language written by hand or not translated. */
export function uiTextsFor(lang: string): Record<string, string> | null {
  return isBuiltIn(lang) ? null : (state().browser.get(lang) ?? null);
}

/** The withdrawal page's own texts, with the same null rule: memory only, so a page may call it while it renders. */
export function returnsTextsFor(lang: string): Record<string, string> | null {
  return isBuiltIn(lang) ? null : (state().returns.get(lang) ?? null);
}
