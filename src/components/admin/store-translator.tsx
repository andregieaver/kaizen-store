"use client";

import { useState, useTransition } from "react";

import { batchItems, type TranslateMode, type TranslateResult } from "@/lib/page-translate-ai";
import { SCOPE_WORDS, TRANSLATE_SCOPES, unitItems, type Accepted, type TranslateScope, type Unit } from "@/lib/store-translate";
import type { PageLanguage } from "@/lib/page-translation";
import type { ApplyResult } from "@/server/store-translate";

const box = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const button = "min-h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40";
const primary = "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40";

type Actions = {
  worklist: (input: unknown) => Promise<{ ok: true; units: Unit[]; total: number } | { ok: false; problem: string }>;
  translate: (request: unknown) => Promise<TranslateResult>;
  apply: (locale: string, accepted: unknown) => Promise<ApplyResult>;
};

type Suggestions = Record<string, string | string[]>;

/**
 * Translate a whole store with AI (D110): choose a language and what to
 * translate, see what there is, let the AI suggest each text, read them and
 * keep the ones that are right. Nothing is written until "Save", and legal
 * texts start unticked.
 */
export function StoreTranslator({
  languages,
  coverage,
  actions,
}: {
  languages: PageLanguage[];
  coverage: Record<string, Record<TranslateScope, number>>;
  actions: Actions;
}) {
  const [main, ...others] = languages;
  const [locale, setLocale] = useState(others[0].locale);
  const [scopes, setScopes] = useState<TranslateScope[]>([...TRANSLATE_SCOPES]);
  const [mode, setMode] = useState<TranslateMode>("missing");
  const [busy, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [work, setWork] = useState<{ units: Unit[]; total: number } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [left, setLeft] = useState<{ key: string; label: string; reason: string }[]>([]);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});
  const target = others.find((l) => l.locale === locale) ?? others[0];

  const reset = () => {
    setWork(null);
    setSuggestions(null);
    setLeft([]);
    setChosen({});
    setEdited({});
    setProblem(null);
    setProgress(null);
  };

  const find = () =>
    start(async () => {
      reset();
      setNotes([]);
      const result = await actions.worklist({ locale, scopes, mode });
      if (!result.ok) return setProblem(result.problem);
      setWork({ units: result.units, total: result.total });
    });

  const translateAll = () =>
    start(async () => {
      if (!work) return;
      setProblem(null);
      const items = unitItems(work.units);
      const batches = batchItems(items);
      const got: Suggestions = {};
      const skipped: typeof left = [];
      for (const [n, batch] of batches.entries()) {
        setProgress(`Translating ${n + 1} of ${batches.length} …`);
        const result = await actions.translate({ from: main.name, to: target.name, items: batch });
        if (!result.ok) {
          setProblem(result.problem);
          setProgress(null);
          return;
        }
        Object.assign(got, result.done);
        skipped.push(...result.skipped);
      }
      setSuggestions(got);
      setLeft(skipped);
      // Everything with a suggestion is ticked, except legal texts, which staff tick after reading them.
      setChosen(Object.fromEntries(work.units.filter((u) => !u.legal && u.items.some((i) => `${u.id}|${i.key}` in got)).map((u) => [u.id, true])));
      setProgress(null);
    });

  const valueOf = (globalKey: string): string | string[] | undefined => (globalKey in edited ? edited[globalKey] : suggestions?.[globalKey]);

  const units = work?.units.filter((u) => u.items.some((i) => suggestions && `${u.id}|${i.key}` in suggestions)) ?? [];
  const picked = units.filter((u) => chosen[u.id]);

  const save = () =>
    start(async () => {
      setProblem(null);
      const accepted: Accepted[] = picked.map((unit) => ({
        unitId: unit.id,
        values: Object.fromEntries(
          unit.items.flatMap((item) => {
            const value = valueOf(`${unit.id}|${item.key}`);
            return value === undefined ? [] : [[item.key, value]];
          }),
        ),
      }));
      let saved = 0;
      const messages: string[] = [];
      for (let i = 0; i < accepted.length; i += 100) {
        setProgress(`Saving ${Math.min(i + 100, accepted.length)} of ${accepted.length} …`);
        const result = await actions.apply(locale, accepted.slice(i, i + 100));
        if (!result.ok) {
          setProblem(result.problem);
          setProgress(null);
          return;
        }
        saved += result.saved;
        messages.push(...result.skipped);
      }
      setProgress(null);
      reset();
      setNotes([`${saved} saved in ${target.name}.`, ...messages, ...(saved > 0 ? ["Pages were saved as drafts: publish them when you have read them."] : [])]);
    });

  const counts = coverage[locale];
  const groups: { title: string; hint?: string; units: Unit[] }[] = [
    { title: "Ready to keep", units: units.filter((u) => !u.legal) },
    {
      title: "Legal texts: read these yourself",
      hint: "Terms, privacy, returns, withdrawal and safety information have legal weight, and a machine translation of them needs a person's review. They start unticked.",
      units: units.filter((u) => u.legal),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <section className={box} aria-labelledby="translate-what">
        <h2 id="translate-what" className="font-medium">1. What to translate</h2>
        <label className="flex max-w-xs flex-col gap-1 text-sm font-medium">
          Into
          <select
            value={locale}
            onChange={(event) => {
              setLocale(event.target.value);
              reset();
            }}
            disabled={busy}
            className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal"
          >
            {others.map((language) => (
              <option key={language.locale} value={language.locale}>{language.name}</option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2 text-sm" disabled={busy}>
          <legend className="font-medium">From {main.name}</legend>
          {TRANSLATE_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) => {
                  setScopes((list) => (event.target.checked ? [...list, scope] : list.filter((s) => s !== scope)));
                  reset();
                }}
              />
              {SCOPE_WORDS[scope].name}
              <span className="text-muted">({counts?.[scope] ?? 0} without {target.name})</span>
            </label>
          ))}
        </fieldset>
        <div role="radiogroup" aria-label="Which texts" className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "missing"} onChange={() => { setMode("missing"); reset(); }} disabled={busy} />
            Only what is not translated yet
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="mode" checked={mode === "all"} onChange={() => { setMode("all"); reset(); }} disabled={busy} />
            Everything again, suggesting new texts for what is translated already
          </label>
        </div>
        <div>
          <button type="button" onClick={find} disabled={busy || scopes.length === 0} className={button}>
            Find texts
          </button>
        </div>
      </section>

      {work && (
        <section className={box} aria-labelledby="translate-ai">
          <h2 id="translate-ai" className="font-medium">2. Translate with AI</h2>
          {work.units.length === 0 ? (
            <p className="text-sm">Nothing to translate: {target.name} has it all.</p>
          ) : (
            <>
              <p className="text-sm">
                {work.units.length} {work.units.length === 1 ? "thing" : "things"} with {unitItems(work.units).length} texts
                {work.total > work.units.length && ` (the first ${work.units.length} of ${work.total}: run it again for the rest)`}.
                Only their words go to the AI, never prices or stock.
              </p>
              {!suggestions && (
                <div>
                  <button type="button" onClick={translateAll} disabled={busy} className={primary}>
                    Translate into {target.name}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {suggestions && (
        <section className={box} aria-labelledby="translate-review">
          <h2 id="translate-review" className="font-medium">3. Read, and keep what is right</h2>
          {groups.map(
            (group) =>
              group.units.length > 0 && (
                <div key={group.title} className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  {group.hint && <p className="text-xs text-muted">{group.hint}</p>}
                  <ul className="flex flex-col gap-3">
                    {group.units.map((unit) => (
                      <li key={unit.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                        <label className="flex items-start gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={chosen[unit.id] === true}
                            onChange={(event) => setChosen((c) => ({ ...c, [unit.id]: event.target.checked }))}
                            className="mt-1"
                          />
                          <span>
                            {unit.title} <span className="font-normal text-muted">· {unit.kind}</span>
                          </span>
                        </label>
                        <dl className="flex flex-col gap-2 pl-6 text-sm">
                          {unit.items.map((item) => {
                            const key = `${unit.id}|${item.key}`;
                            const value = valueOf(key);
                            if (value === undefined) return null;
                            return (
                              <div key={key} className="grid gap-1 sm:grid-cols-2">
                                <div>
                                  <dt className="text-xs text-muted">{item.label} · {main.name}</dt>
                                  <dd className="whitespace-pre-wrap">{item.runs.join("")}</dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-muted">{target.name}</dt>
                                  <dd>
                                    {typeof value === "string" ? (
                                      <textarea
                                        value={value}
                                        onChange={(event) => setEdited((e) => ({ ...e, [key]: event.target.value }))}
                                        rows={Math.min(8, Math.max(1, Math.ceil(value.length / 50)))}
                                        aria-label={`${item.label} in ${target.name}`}
                                        className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
                                      />
                                    ) : (
                                      <span className="whitespace-pre-wrap">{value.join("")}</span>
                                    )}
                                  </dd>
                                </div>
                              </div>
                            );
                          })}
                        </dl>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
          )}
          {left.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-muted">
              <p className="font-medium">Left as they are, in {main.name}:</p>
              <ul className="list-disc pl-5">
                {left.slice(0, 15).map((entry) => (
                  <li key={entry.key}>{entry.label}: {entry.reason}</li>
                ))}
                {left.length > 15 && <li>…and {left.length - 15} more.</li>}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy || picked.length === 0} className={primary}>
              Save {picked.length} in {target.name}
            </button>
            <button type="button" onClick={reset} disabled={busy} className={button}>
              Start over
            </button>
            <span className="text-xs text-muted">Pages are saved as drafts; products and menus are live once saved.</span>
          </div>
        </section>
      )}

      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
        {progress && <p>{progress}</p>}
        {problem && <p className="text-red-700 dark:text-red-400">{problem}</p>}
        {notes.map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>
    </div>
  );
}

