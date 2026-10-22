"use client";

import { useEffect, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { SavedPart } from "@/lib/saved-parts";
import type { SectionResult, ThemeSectionsOffer } from "@/lib/theme-sections";

import { useAdminText } from "./admin-text";

/** What the builder is given to offer the live theme's sections (D272). */
export type ThemeSectionActions = { list: () => Promise<ThemeSectionsOffer>; place: (key: string) => Promise<SectionResult> };

/**
 * *From your theme* on the builder's Rows tab (D272): the live signature theme's own sections, each a press away. A press asks the server
 * for the section (its words written for any store, its pictures copied into the owner's library) and puts it at the end of the page, as a
 * template is placed. Nothing shows while the theme has none; the list is read the first time the tab is shown.
 */
export function ThemeSectionsList({
  actions,
  shown,
  onPlace,
  disabled,
}: {
  actions: ThemeSectionActions;
  /** The Rows tab is open, in a sidebar that is open. */
  shown: boolean;
  onPlace: (part: SavedPart) => void;
  /** The page holds as many rows as it may. */
  disabled: boolean;
}) {
  const [offer, setOffer] = useState<ThemeSectionsOffer | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const w = useAdminText("builder").themeSections;

  useEffect(() => {
    if (!shown || offer !== undefined) return;
    let current = true;
    actions
      .list()
      .then((found) => current && setOffer(found))
      .catch(() => current && setOffer(null));
    return () => {
      current = false;
    };
  }, [shown, offer, actions]);

  if (!offer || offer.sections.length === 0) return null;

  async function place(key: string) {
    setBusy(key);
    setProblem(null);
    try {
      const result = await actions.place(key);
      if (result.ok) onPlace(result.part);
      else setProblem(result.problem);
    } catch {
      setProblem(w.failed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label={fillWords(w.from, { theme: offer.theme })} className="flex flex-col gap-3">
      <h3 className="text-eyebrow text-muted uppercase">{fillWords(w.from, { theme: offer.theme })}</h3>
      <p className="text-xs text-muted">
        {w.intro}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {offer.sections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => place(section.key)}
            disabled={disabled || busy !== null}
            aria-busy={busy === section.key}
            aria-label={fillWords(w.add, { name: section.name })}
            title={section.description}
            className="flex flex-col gap-1 rounded-panel p-1 text-left hover:bg-sunken disabled:opacity-40"
          >
            {section.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element -- a small picture from the theme's demo store
              <img src={section.thumb} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-panel border border-line object-cover" />
            ) : (
              <span aria-hidden="true" className="flex aspect-[4/3] w-full items-center justify-center rounded-panel border border-line bg-sunken text-caption text-muted">
                Aa
              </span>
            )}
            <span className="text-xs">{busy === section.key ? w.adding : section.name}</span>
          </button>
        ))}
      </div>
      {problem && (
        <p role="alert" className="text-xs text-danger-text">
          {problem}
        </p>
      )}
    </section>
  );
}
