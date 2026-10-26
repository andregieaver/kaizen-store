"use client";

import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminAreaMessages } from "@/lib/admin-text";
import { SYNONYMS_MAX, synonymLine, type SynonymKind } from "@/lib/search-synonyms";

export type SynonymWords = AdminAreaMessages["bookings"]["search"]["synonyms"];

/** A server action a form posts to, as `ActionForm` takes it. */
export type FormAction = Parameters<typeof ActionForm>[0]["action"];

export type SynonymLine = { id: string; locale: string; kind: SynonymKind; words: string[]; means: string[]; remove: FormAction };

/**
 * The Search page's *Synonyms* card (wave 6 unit F1, D324): the store's groups as lines, by language, and a short form to add one. Only
 * members with `settings:write` get the form and the Remove buttons (`canWrite`).
 */
export function SynonymsCard({
  words: w,
  lines,
  languages,
  canWrite,
  save,
  prefill,
}: {
  words: SynonymWords;
  lines: SynonymLine[];
  /** The store's kept languages with their names, the main one first, then any a group is left in (`kept` false: listed, never offered). */
  languages: { locale: string; name: string; kept: boolean }[];
  canWrite: boolean;
  save: FormAction;
  /** A search's words to start a group with, from the zero-result list. */
  prefill: string | null;
}) {
  const [kind, setKind] = useState<SynonymKind>("both");
  const several = languages.length > 1;
  const offered = languages.filter((language) => language.kept);
  return (
    <Card title={w.title} description={w.description} aside={fillWords(w.count, { n: lines.length, max: SYNONYMS_MAX })}>
      <div id="synonyms" className="flex flex-col gap-5">
        {languages.map(({ locale, name }) => {
          const own = lines.filter((line) => line.locale === locale);
          return (
            <div key={locale} className="flex flex-col gap-2">
              {several && <h3 className="text-eyebrow text-muted">{name}</h3>}
              {own.length === 0 ? (
                <p className="text-sm text-muted">{w.none}</p>
              ) : (
                <ul className="divide-y divide-line rounded-panel border border-line text-sm">
                  {own.map((line) => (
                    <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="break-words">{synonymLine(line)}</span>
                      {canWrite && (
                        <ActionForm action={line.remove} className="flex items-center gap-2" successMessage={w.removed}>
                          <SubmitButton variant="secondary">{w.remove}</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {canWrite && (
          <ActionForm action={save} className="flex flex-col gap-3 border-t border-line pt-4" successMessage={w.saved}>
            <h3 className="text-body-strong text-ink">{w.add}</h3>
            {offered.length > 1 ? (
              <label className="flex max-w-xs flex-col gap-1 text-sm">
                {w.language}
                <select name="locale" defaultValue={offered[0]?.locale} className="min-h-10 rounded-panel border border-edge bg-card px-3">
                  {offered.map(({ locale, name }) => (
                    <option key={locale} value={locale}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="locale" value={offered[0]?.locale ?? ""} />
            )}
            <fieldset className="flex flex-col gap-2 text-sm">
              {(
                [
                  ["both", w.kindBoth, w.kindBothHint],
                  ["one_way", w.kindOneWay, w.kindOneWayHint],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex items-start gap-2">
                  <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="mt-1" />
                  <span>
                    {label}
                    <span className="block text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-sm">
              {w.words}
              <input name="words" required maxLength={1500} defaultValue={prefill ?? ""} className="min-h-10 rounded-panel border border-edge bg-card px-3" aria-describedby="synonym-words-hint" />
              <span id="synonym-words-hint" className="text-muted">
                {w.wordsHint}
              </span>
            </label>
            {kind === "one_way" && (
              <label className="flex flex-col gap-1 text-sm">
                {w.means}
                <input name="means" required maxLength={1500} className="min-h-10 rounded-panel border border-edge bg-card px-3" />
              </label>
            )}
            <div>
              <SubmitButton>{w.save}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
