"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/admin/ui";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { HIGHLIGHT_KINDS, HIGHLIGHT_WORDS_MAX, type HighlightKind, type HighlightWords } from "@/lib/theme-highlights";
import type { HighlightSuggestion } from "@/server/theme-highlight-words";

type Lines = Record<HighlightKind, { title: string; text: string }>;

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The words beside a theme's three highlights (`docs/theme-showcase-phase-2.md` step 2), part of its listing form: a title and a line each.
 * *Suggest words* asks Kaizena Flow's text model and puts its answer in the fields, unsaved, for the person to read and change; nothing the
 * model writes is kept until the form is saved.
 */
export function HighlightWordsFields({ initial, suggest }: { initial: HighlightWords | undefined; suggest: () => Promise<HighlightSuggestion> }) {
  const site = useAdminText("platformSite");
  const f = site.fields;
  const names = site.tables.highlights;
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
      const left = answer.leftOut.map((kind) => names[kind].toLowerCase());
      setNote({
        kind: "ok",
        text: `${f.suggested}${left.length > 0 ? ` ${fillWords(f.leftOut, { list: left.join(", ") })}` : ""}`,
      });
    });

  return (
    <fieldset className="flex flex-col gap-3 text-sm" aria-busy={pending || undefined}>
      <legend className="mb-1 font-medium">{f.highlights}</legend>
      <p className="text-muted">{f.highlightsNote}</p>
      {HIGHLIGHT_KINDS.map((kind) => (
        <div key={kind} className="flex flex-col gap-2 rounded-panel border border-line p-3" data-highlight-words={kind}>
          <p className="text-caption text-muted">{names[kind]}</p>
          <label className="flex flex-col gap-1 font-medium">
            {f.title}
            <input name={`highlight:${kind}:title`} maxLength={HIGHLIGHT_WORDS_MAX.title} value={lines[kind].title} onChange={(e) => set(kind, "title", e.target.value)} className={control} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {f.line}
            <input name={`highlight:${kind}:text`} maxLength={HIGHLIGHT_WORDS_MAX.text} value={lines[kind].text} onChange={(e) => set(kind, "text", e.target.value)} className={control} />
          </label>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" kind="secondary" onClick={ask} disabled={pending}>
          {pending ? f.asking : f.suggest}
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
