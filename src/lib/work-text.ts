import { cache } from "react";

import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import { adminText } from "./admin-text";

/**
 * Work's words for a server component (D312 A10), read synchronously: a Work page sets the request's language once
 * (`workWords()` in `src/server/work-words.ts`) and the components it draws read it here. `cache()` keeps it per request on
 * the server; anywhere else (a test, a job) it is English.
 */
const current = cache((): { lang: AdminLang } => ({ lang: "en" }));

export function setWorkLang(lang: AdminLang): void {
  current().lang = lang;
}

export function workText() {
  return adminText(current().lang, "work");
}

export function workLocale(): string {
  return ADMIN_LANG_FACTS[current().lang].locale;
}

type Words = string | readonly Words[] | { readonly [key: string]: Words };

/** The catalogue's texts side by side: the English and the same text in `lang`, by the same key. */
function pairs(en: Words, other: Words | undefined, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof en === "string") {
    if (typeof other === "string" && other !== en) out.push([en, other]);
  } else if (Array.isArray(en)) {
    en.forEach((item, i) => pairs(item, (other as readonly Words[] | undefined)?.[i], out));
  } else {
    for (const [key, value] of Object.entries(en)) pairs(value, (other as Record<string, Words> | undefined)?.[key], out);
  }
  return out;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A refusal Work's server wrote in English (`work-errors.ts`, the `errors` texts) in the account's language: every
 * known text in it is put in that language, longest first, a template's `{name}` kept as it was filled in. Text it does
 * not know stays as written (D312 A10, as `marketingProblem()` does for A6).
 */
export function workProblemText(message: string, lang: AdminLang = current().lang): string {
  if (lang === "en") return message;
  const found = pairs(adminText("en", "work").errors, adminText(lang, "work").errors).sort((a, b) => b[0].length - a[0].length);
  let out = message;
  for (const [en, other] of found) {
    if (!en.includes("{")) {
      out = out.split(en).join(other);
      continue;
    }
    const names: string[] = [];
    const pattern = escape(en).replace(/\\\{(\w+)\\\}/g, (_, name: string) => {
      names.push(name);
      return "(.+?)";
    });
    out = out.replace(new RegExp(pattern, "g"), (...match) =>
      other.replace(/\{(\w+)\}/g, (whole, name: string) => {
        const i = names.indexOf(name);
        return i >= 0 ? String(match[i + 1]) : whole;
      }),
    );
  }
  return out;
}

/** The same for a result: its problems in the account's language, anything else as it was. */
export function inWorkLang<T>(result: T, lang: AdminLang = current().lang): T {
  if (lang === "en" || !result || typeof result !== "object") return result;
  const problems = (result as { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return result;
  return { ...result, problems: problems.map((p) => (typeof p === "string" ? workProblemText(p, lang) : p)) };
}
