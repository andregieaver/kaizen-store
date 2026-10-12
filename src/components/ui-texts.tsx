"use client";

import { browserText } from "@/lib/browser-text";
import { overlayMessages } from "@/lib/ui-catalog";
import { registerMessages } from "@/lib/ui-registry";

const registered = new Map<string, number>();

/**
 * Gives the browser the interface text of a language translated by AI (D111),
 * so client components' `t(lang)` speak it. It renders nothing and sits before
 * the page in the layout, inside `LanguageTexts` (which gives it English to lay the
 * texts over, D212), so the text is there when they render. The server
 * has it already (read from the database), so it registers only in the browser.
 */
export function UiTexts({ lang, texts }: { lang: string; texts: Record<string, string> | null }) {
  if (texts && typeof window !== "undefined") {
    const version = Object.values(texts).reduce((n, text) => n + text.length, Object.keys(texts).length);
    if (registered.get(lang) !== version) {
      registerMessages(lang, { ui: overlayMessages("ui", browserText("en"), texts, lang) });
      registered.set(lang, version);
    }
  }
  return null;
}
