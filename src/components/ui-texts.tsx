"use client";

import { browserText } from "@/lib/browser-text";
import { overlayMessages } from "@/lib/ui-catalog";
import { registerMessages, registeredTexts } from "@/lib/ui-registry";

const registered = new Map<string, number>();

/**
 * Gives the browser the interface text of a language translated by AI (D111),
 * so client components' `t(lang)` speak it. It renders nothing and sits before
 * the page in the layout, so the text is there when they render. The layout
 * sends the texts the browser's components read (`browserText()`, D212); the
 * withdrawal page sends its own with `part="returns"`, which the browser keeps
 * for `returnsText()`. The server has it already (read from the database), so
 * it registers only in the browser.
 */
export function UiTexts({ lang, texts, part = "browser" }: { lang: string; texts: Record<string, string> | null; part?: "browser" | "returns" }) {
  if (texts && typeof window !== "undefined") {
    const version = Object.values(texts).reduce((n, text) => n + text.length, Object.keys(texts).length);
    const id = `${lang}:${part}`;
    if (registered.get(id) !== version) {
      if (part === "browser") registerMessages(lang, { ui: overlayMessages("ui", browserText("en"), texts, lang), texts: { ...registeredTexts(lang), ...texts } });
      else registerMessages(lang, { texts: { ...registeredTexts(lang), ...texts } });
      registered.set(id, version);
    }
  }
  return null;
}
