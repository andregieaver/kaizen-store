"use client";

import { useState } from "react";

import type { SavedPart } from "@/lib/saved-parts";
import type { TemplateActions, TemplateItem, TemplateResult } from "@/lib/templates";

/**
 * Using a template (D125, D127): asking the server for its copy, from the Templates tab, the Browse modal or the preview,
 * and what each of them says while it waits or when it fails. The builder holds one of these, so a template being fetched
 * is fetched once, wherever its button was pressed.
 */

export const USE_PROBLEM = "It could not be added. Try again.";

/** Asks for a template's copy; a network failure or a thrown error becomes a problem to show, never an exception. */
export async function fetchTemplate(actions: TemplateActions, id: string): Promise<TemplateResult<{ part: SavedPart }>> {
  try {
    return await actions.use(id);
  } catch {
    return { ok: false, problems: [USE_PROBLEM] };
  }
}

export type TemplateUse = {
  /** The template being fetched now, if any. */
  using: string | null;
  /** What went wrong with the last try, by template id. */
  issues: Readonly<Record<string, string[]>>;
  /** A row, column or component that was just placed on the page (a page layout asks first, so is not "added" yet). */
  added: string | null;
  run: (item: TemplateItem) => void;
};

/** `onPart` gets the copy: the builder places it, or for a page layout asks how. */
export function useTemplateUse(actions: TemplateActions | null, onPart: (part: SavedPart, item: TemplateItem) => void): TemplateUse {
  const [using, setUsing] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string[]>>({});
  const [added, setAdded] = useState<string | null>(null);
  const run = async (item: TemplateItem) => {
    if (!actions || using !== null) return;
    setUsing(item.id);
    setAdded(null);
    setIssues((current) => ({ ...current, [item.id]: [] }));
    const result = await fetchTemplate(actions, item.id);
    if (result.ok) {
      onPart(result.part, item);
      if (result.part.kind !== "page") setAdded(item.id);
    } else {
      setIssues((current) => ({ ...current, [item.id]: result.problems }));
    }
    setUsing(null);
  };
  return { using, issues, added, run: (item) => void run(item) };
}
