"use client";

import { useState, useTransition } from "react";

import type { ChunkResult } from "@/server/ui-text";
import { CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";

const button = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40";

type Plan = { ok: true; keys: string[] } | { ok: false; problem: string };

/**
 * Translates a language's interface text with Kaizen's AI (D111): asks the
 * server which texts are to be done, then sends them in chunks so a long run
 * never waits on one request, and says how it went. What passes the checks is
 * kept as a draft for a person to read.
 */
export function UiTranslator({
  name,
  counts,
  plan,
  generate,
}: {
  name: string;
  counts: { missing: number; stale: number; ai: number };
  plan: (mode: "missing" | "stale" | "all") => Promise<Plan>;
  generate: (keys: string[]) => Promise<ChunkResult>;
}) {
  const [busy, start] = useTransition();
  const w = useAdminText("platformTools").languages.translator;
  const [progress, setProgress] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [left, setLeft] = useState<{ key: string; problem: string }[]>([]);

  const run = (mode: "missing" | "stale" | "all") =>
    start(async () => {
      setProblem(null);
      setSummary(null);
      setLeft([]);
      const planned = await plan(mode);
      if (!planned.ok) return setProblem(planned.problem);
      if (planned.keys.length === 0) return setSummary(w.nothing);
      let saved = 0;
      const problems: { key: string; problem: string }[] = [];
      const size = 40;
      for (let i = 0; i < planned.keys.length; i += size) {
        setProgress(fillWords(w.progress, { done: Math.min(i + size, planned.keys.length), total: planned.keys.length }));
        const result = await generate(planned.keys.slice(i, i + size));
        if (!result.ok) {
          setProblem(result.problem);
          setProgress(null);
          setSummary(saved > 0 ? fillWords(w.keptBefore, { n: saved }) : null);
          return;
        }
        saved += result.saved;
        problems.push(...result.problems);
      }
      setProgress(null);
      setLeft(problems);
      setSummary(fillWords(w.summary, { saved, total: planned.keys.length, name, left: problems.length > 0 ? fillWords(w.leftForYou, { n: problems.length }) : "" }));
    });

  return (
    <div className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
      <h2 className="text-title text-ink">{w.title}</h2>
      <p className="text-sm text-muted">{w.text}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy || counts.missing === 0} onClick={() => run("missing")}>
          {fillWords(w.missing, { n: counts.missing })}
        </button>
        <button type="button" className={button} disabled={busy || counts.stale === 0} onClick={() => run("stale")}>
          {fillWords(w.stale, { n: counts.stale })}
        </button>
        <button type="button" className={button} disabled={busy || counts.ai === 0} onClick={() => run("all")}>
          {fillWords(w.again, { n: counts.ai })}
        </button>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
        {progress && <p>{progress}</p>}
        {problem && <p className="text-danger-text">{problem}</p>}
        {summary && <p>{summary}</p>}
        {left.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted">
            {left.slice(0, 12).map((entry) => (
              <li key={entry.key}>
                {entry.key.replace(/^(ui|email):/, "")}: {entry.problem}
              </li>
            ))}
            {left.length > 12 && <li>{fillWords(w.more, { n: left.length - 12 })}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
