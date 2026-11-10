"use client";

import type { FocusEvent, ReactNode } from "react";
import { fieldLang, holdsWords, type SpellField } from "@/lib/spell-check";

/** Focus events a scope has handled: an inner scope (one editor of a dual page inside another) decides, not the ones around it. */
const handled = new WeakSet<Event>();

/** Marks a `lang` the scope wrote, so a later version's language replaces it and a component's own is never touched. */
const MARK = "data-kz-spell-lang";

function readField(el: HTMLElement): SpellField {
  const input = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
  return {
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? (el.getAttribute("type") ?? "") : "",
    spellcheck: el.getAttribute("spellcheck"),
    // The host of editable content only, not a paragraph inside it: focus lands on the host.
    editableHost: el.isContentEditable && (el.getAttribute("contenteditable") ?? "false").toLowerCase() !== "false",
    readOnly: input?.readOnly ?? false,
    disabled: input?.disabled ?? false,
    inputMode: el.getAttribute("inputmode") ?? "",
    lang: el.getAttribute("lang"),
    langOurs: el.hasAttribute(MARK),
  };
}

/**
 * Spell-check for the words typed inside it, in the language of the version
 * being edited: every text field, text area and editable text of the page
 * builder (its sidebars, its dialogs, which React reaches through their
 * portals, and the canvas) and of the live site's text editor. A field is
 * marked when it takes the focus, so the admin's own labels keep the admin's
 * language for screen readers; `spellCheck={false}` on a field (CSS, HTML,
 * addresses) keeps it out. Without `lang` the field keeps the language it
 * inherits (the live page's own). The innermost scope decides.
 */
export function SpellCheckScope({ lang, children }: { lang?: string | null; children: ReactNode }) {
  const mark = (event: FocusEvent<HTMLDivElement>) => {
    if (handled.has(event.nativeEvent)) return;
    handled.add(event.nativeEvent);
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;
    const field = readField(el);
    if (!holdsWords(field)) return;
    if (field.spellcheck === null) el.spellcheck = true;
    const next = fieldLang(field, lang);
    if (next) {
      el.setAttribute("lang", next);
      el.setAttribute(MARK, "");
    }
  };
  return (
    <div className="contents" onFocus={mark}>
      {children}
    </div>
  );
}
