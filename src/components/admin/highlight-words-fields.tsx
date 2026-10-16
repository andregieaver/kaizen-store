"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/admin/ui";
import { HIGHLIGHT_KINDS, HIGHLIGHT_NAMES, HIGHLIGHT_WORDS_MAX, type HighlightKind, type HighlightWords } from "@/lib/theme-highlights";
import type { HighlightSuggestion } from "@/server/theme-highlight-words";

type Lines = Record<HighlightKind, { title: string; text: string }>;

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The words beside a theme's three highlights (`docs/theme-showcase-phase-2.md` step 2), part of its listing form: a title and a line each.
 * *Suggest words* asks Kaizena Flow's text model and puts its answer in the fields, unsaved, for the person to read and change; nothing the
 * model writes is kept until the form is saved.
 */
export function HighlightWordsFields({ initial, suggest }: { initial: HighlightWords | undefined; suggest: () => Promise<HighlightSuggestion> }) {
  const [lines, setLines] = useState<Lines>(
    () => Object.fromEntries(HIGHLIGHT_KINDS.map((kind) => [kind, { title: initial?.[kind]?.title ?? "", text: initial?.[kind]?.text ?? "" }])) as Lines,
  );
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (kind: HighlightKind, field: "title" | "text", value: string) => setLines((now) => ({ ...now, [kind]: { ...now[kind], [field]: value } }));

  const ask = () =>
    start(async () => {
      const answer = await suggest();
      if (!answer.ok) {
        setNote({ kind: "error", text: answer.problem });
        return;
      }
      setLines((now) => {
        const next = { ...now };
        for (const kind of HIGHLIGHT_KINDS) if (answer.words[kind]) next[kind] = { title: answer.words[kind].title, text: answer.words[kind].text };
        return next;
      });
      const left = answer.leftOut.map((kind) => HIGHLIGHT_NAMES[kind].toLowerCase());
      setNote({
        kind: "ok",
        text: `Suggested from the theme's facts: read them, change what you like, then save.${left.length > 0 ? ` Left out because they made claims: ${left.join(", ")}.` : ""}`,
      });
    });

  return (
    <fieldset className="flex flex-col gap-3 text-sm" aria-busy={pending || undefined}>
      <legend className="mb-1 font-medium">Highlights</legend>
      <p className="text-muted">The words beside the three pictures made from the theme&apos;s photographs. A highlight without a title shows its picture alone.</p>
      {HIGHLIGHT_KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-2 rounded-panel border border-line p-3" data-highlight-words={kind}>
          <p className="text-caption text-muted">{HIGHLIGHT_NAMES[kind]}</p>
          <label className="flex flex-col gap-1 font-medium">
            Title
            <input name={`highlight:${kind}:title`} maxLength={HIGHLIGHT_WORDS_MAX.title} value={lines[kind].title} onChange={(e) => set(kind, "title", e.target.value)} className={control} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Line
            <input name={`highlight:${kind}:text`} maxLength={HIGHLIGHT_WORDS_MAX.text} value={lines[kind].text} onChange={(e) => set(kind, "text", e.target.value)} className={control} />
          </label>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" kind="secondary" onClick={ask} disabled={pending}>
          {pending ? "Asking…" : "Suggest words"}
        </Button>
        {note && (
          <p role="status" className={note.kind === "error" ? "text-danger-text" : "text-muted"}>
            {note.text}
          </p>
        )}
      </div>
    </fieldset>
  );
}
