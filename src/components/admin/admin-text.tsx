"use client";

import { use, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ADMIN_LANG_FACTS, ADMIN_LANG_KEY, ADMIN_LANGS, type AdminLang } from "@/lib/admin-lang";
import { commonEn } from "@/lib/admin-messages/common.en";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import type { AdminAreaMessages, ClientArea, HandedArea } from "@/lib/admin-text";

import { AdminTextContext } from "./admin-text-context";
import { arrivedEnglish, englishLater, noteFallback, type LaterArea } from "./admin-text-later";

/**
 * The admin's words in the browser (D312 A0, `docs/platform-admin-i18n.md` 3.3): the signed-in layout hands its client parts the account's
 * language and the slices of the catalogue they read (`adminTexts()`), and a part asks `useAdminText(area)`. An area not handed down is
 * read in English, fetched then (`admin-text-later.ts`), so a part converted before its layout still draws.
 */

/**
 * The two areas read outside the signed-in admin too (`useCommonText()`, `useSignInText()`), so their English is at hand at once. Every
 * other area's English is fetched only when a part reads one that nothing handed down (`admin-text-later.ts`, PSI PERF-01).
 */
const ENGLISH = { common: commonEn, signIn: signInEn } as const;
type AtHand = keyof typeof ENGLISH;

export { AdminTextProvider } from "./admin-text-context";

/**
 * More areas for the client parts under it (D312 A4): a page hands down the slices its own parts read (`adminTexts(lang, ["orders"])`),
 * kept beside the layout's, so the layout's provider stays small.
 */
export function AdminTextScope({ texts, children }: { texts: Partial<AdminAreaMessages>; children: ReactNode }) {
  const parent = useContext(AdminTextContext);
  return <AdminTextContext.Provider value={{ lang: parent.lang, texts: { ...parent.texts, ...texts } }}>{children}</AdminTextContext.Provider>;
}

type AreaWords<A extends ClientArea> = Pick<AdminAreaMessages, ClientArea>[A];

/** An area's words in the account's language. */
export function useAdminText<A extends ClientArea>(area: A): AreaWords<A> {
  const { texts } = useContext(AdminTextContext);
  const handed = texts[area] as AreaWords<A> | undefined;
  if (handed) return handed;
  if (area in ENGLISH) return ENGLISH[area as AtHand] as AreaWords<A>;
  noteFallback(area);
  return (arrivedEnglish(area as LaterArea) ?? use(englishLater(area as LaterArea))) as AreaWords<A>;
}

/**
 * A server-only area the page handed down on purpose (`HandedArea`), or null where it did not: the part then uses the English of its own
 * module (the builder's shop parts from `store-parts.ts`), so no catalogue is added to every screen's first scripts.
 */
export function useHandedText<A extends HandedArea>(area: A): AdminAreaMessages[A] | null {
  const { texts } = useContext(AdminTextContext);
  return (texts[area] as AdminAreaMessages[A] | undefined) ?? null;
}

/** The account's language for the admin. */
export function useAdminLang(): AdminLang {
  return useContext(AdminTextContext).lang;
}

/** Keeps the browser's copy of the account's language (for `<html lang>` before paint, `adminLangScript()`) in step with the account. */
export function AdminLangSync({ lang }: { lang: AdminLang }) {
  useEffect(() => {
    document.documentElement.lang = ADMIN_LANG_FACTS[lang].tag;
    try {
      if (localStorage.getItem(ADMIN_LANG_KEY) !== lang) localStorage.setItem(ADMIN_LANG_KEY, lang);
    } catch {
      // Storage refused (a private window): the page's own `lang` is set above.
    }
  }, [lang]);
  return null;
}

export type SaveAdminLang = (lang: AdminLang) => Promise<void>;

/** Saves a language and draws the admin again in it: its words are the server's. */
function useChoose(save: SaveAdminLang) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (lang: AdminLang) =>
    start(async () => {
      try {
        localStorage.setItem(ADMIN_LANG_KEY, lang);
      } catch {}
      document.documentElement.lang = ADMIN_LANG_FACTS[lang].tag;
      await save(lang);
      router.refresh();
    });
  return { pending, choose };
}

/** Your account's choice of the admin's language: each language by its own name, whatever the admin is in now. */
export function AdminLanguageField({ save }: { save: SaveAdminLang }) {
  const lang = useAdminLang();
  const w = useAdminText("common").language;
  const { pending, choose } = useChoose(save);
  // The account's language; while a choice saves and the admin is drawn again, the radio holds what was pressed.
  const [picked, setPicked] = useState(lang);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{w.title}</legend>
      <div className="flex flex-wrap gap-2">
        {ADMIN_LANGS.map((option) => (
          <label
            key={option}
            lang={ADMIN_LANG_FACTS[option].tag}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm has-checked:border-brand has-checked:font-medium"
          >
            <input
              type="radio"
              name="admin-language"
              value={option}
              checked={picked === option}
              disabled={pending}
              onChange={() => {
                setPicked(option);
                choose(option);
              }}
            />
            {ADMIN_LANG_FACTS[option].name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {pending ? w.saving : w.kept}
      </p>
    </fieldset>
  );
}

/** The account menu's language switch: each other language by its own name, a press away. */
export function AdminLanguageSwitch({ save }: { save: SaveAdminLang }) {
  const lang = useAdminLang();
  const { pending, choose } = useChoose(save);
  return (
    <span className="flex items-center gap-1">
      {ADMIN_LANGS.map((option) => (
        <button
          key={option}
          type="button"
          lang={ADMIN_LANG_FACTS[option].tag}
          aria-pressed={option === lang}
          disabled={pending || option === lang}
          onClick={() => choose(option)}
          className="rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:font-medium aria-pressed:text-ink"
        >
          {ADMIN_LANG_FACTS[option].name}
        </button>
      ))}
    </span>
  );
}
