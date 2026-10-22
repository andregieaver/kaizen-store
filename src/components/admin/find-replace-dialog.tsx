"use client";

import { useId, useMemo, useState } from "react";

import type { PageContent } from "@/lib/page-content";
import { FIND_MAX, findInPage, type FindOptions } from "@/lib/page-find-replace";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";
import { countWords, fillWords } from "@/lib/admin-fill";

/**
 * Find and replace (D307): the words typed are found in every text of the page as it is being written (the language chosen), and
 * *Replace all* changes them everywhere at once and closes, the editor's status line saying how many. One step away for Lisa:
 * match case, whole words, and a tick per text to leave some as they are. The change is the editor's, unsaved, and Undo takes it back.
 */
export function FindReplaceDialog({
  open,
  onClose,
  content,
  onReplace,
}: {
  open: boolean;
  onClose: () => void;
  /** The page as the language being written reads. */
  content: PageContent;
  onReplace: (query: string, replacement: string, options: FindOptions, only: ReadonlySet<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState<FindOptions>({});
  const [more, setMore] = useState(false);
  // Texts ticked off, by their place; everything found is replaced unless ticked off.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const findId = useId();
  const w = useAdminText("builder").find;
  const replaceId = useId();

  const found = useMemo(() => (open ? findInPage(content, query, options) : []), [open, content, query, options]);
  const chosen = found.filter((f) => !left.has(f.key));
  const total = chosen.reduce((sum, f) => sum + f.count, 0);

  const toggle = (key: string) =>
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const replace = () => {
    if (total === 0) return;
    onReplace(query, replacement, options, new Set(chosen.map((f) => f.key)));
    setLeft(new Set());
    // Done: the editor says what was replaced, under the page it was replaced in.
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={w.title}
      wide
      footer={
        <>
          <button type="button" onClick={onClose} className="min-h-11 rounded-pill border border-edge px-4 hover:bg-sunken">
            {w.close}
          </button>
          <button
            type="button"
            onClick={replace}
            disabled={total === 0}
            className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
          >
            {total === 0 ? w.replaceAll : countWords(total, w.replaceSome)}
          </button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          replace();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label htmlFor={findId} className="grid gap-1 text-sm">
            {w.find}
            <input
              id={findId}
              value={query}
              maxLength={FIND_MAX}
              autoFocus
              onChange={(event) => {
                setQuery(event.target.value);
                setLeft(new Set());
              }}
              className="min-h-11 rounded-lg border border-edge bg-card px-3"
            />
          </label>
          <label htmlFor={replaceId} className="grid gap-1 text-sm">
            {w.replaceWith}
            <input
              id={replaceId}
              value={replacement}
              maxLength={FIND_MAX}
              onChange={(event) => setReplacement(event.target.value)}
              className="min-h-11 rounded-lg border border-edge bg-card px-3"
            />
          </label>
        </div>
        {/* Submitting with Enter replaces, as the main button does. */}
        <button type="submit" hidden tabIndex={-1} />

        <p role="status" aria-live="polite" className="text-sm text-ink-2">
          {query === ""
            ? w.typeWords
            : found.length === 0
              ? w.notFound
              : fillWords(w.found, { n: found.reduce((sum, f) => sum + f.count, 0), texts: countWords(found.length, w.texts) })}
        </p>

        <div>
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="text-sm underline">
            {more ? w.fewer : w.more}
          </button>
          {more && (
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!options.matchCase}
                    onChange={(event) => setOptions((o) => ({ ...o, matchCase: event.target.checked }))}
                  />
                  {w.matchCase}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!options.wholeWords}
                    onChange={(event) => setOptions((o) => ({ ...o, wholeWords: event.target.checked }))}
                  />
                  {w.wholeWords}
                </label>
              </div>
              {found.length > 0 && (
                <ul aria-label={w.where} className="grid max-h-80 gap-1 overflow-y-auto rounded-panel border border-line p-2">
                  {found.map((f) => (
                    <li key={f.key}>
                      <label className="flex items-start gap-2 rounded-lg p-2 text-sm hover:bg-sunken">
                        <input type="checkbox" checked={!left.has(f.key)} onChange={() => toggle(f.key)} className="mt-1" />
                        <span className="grid gap-0.5">
                          <span className="text-caption text-muted">
                            {f.label}
                            {f.count > 1 ? ` · ${fillWords(w.times, { n: f.count })}` : ""}
                          </span>
                          <span className="text-ink">
                            {f.before}
                            <mark className="rounded bg-warning-soft px-0.5 text-ink">{f.match}</mark>
                            {f.after}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
