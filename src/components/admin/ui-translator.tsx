"use client";

import { useState, useTransition } from "react";

import type { ChunkResult } from "@/server/ui-text";

const button = "min-h-10 rounded-md border border-border bg-background px-4 text-sm disabled:opacity-40";
const primary = "min-h-10 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40";

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
      if (planned.keys.length === 0) return setSummary("Nothing to translate.");
      let saved = 0;
      const problems: { key: string; problem: string }[] = [];
      const size = 40;
      for (let i = 0; i < planned.keys.length; i += size) {
        setProgress(`Translating ${Math.min(i + size, planned.keys.length)} of ${planned.keys.length} …`);
        const result = await generate(planned.keys.slice(i, i + size));
        if (!result.ok) {
          setProblem(result.problem);
          setProgress(null);
          setSummary(saved > 0 ? `${saved} texts were kept before it stopped.` : null);
          return;
        }
        saved += result.saved;
        problems.push(...result.problems);
      }
      setProgress(null);
      setLeft(problems);
      setSummary(`${saved} of ${planned.keys.length} texts translated into ${name}${problems.length > 0 ? `; ${problems.length} left for you` : ""}. They are drafts until you read them.`);
    });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
      <h2 className="font-medium">Translate with AI</h2>
      <p className="text-sm text-muted">
        Kaizen&apos;s AI translates the storefront&apos;s and the emails&apos; text from English. Every text is checked for its placeholders
        and plural forms; one that fails is left for you. Texts you have edited yourself are never replaced.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primary} disabled={busy || counts.missing === 0} onClick={() => run("missing")}>
          Translate the {counts.missing} missing
        </button>
        <button type="button" className={button} disabled={busy || counts.stale === 0} onClick={() => run("stale")}>
          Update {counts.stale} whose English changed
        </button>
        <button type="button" className={button} disabled={busy || counts.ai === 0} onClick={() => run("all")}>
          Translate {counts.ai} again
        </button>
      </div>
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-sm">
        {progress && <p>{progress}</p>}
        {problem && <p className="text-red-700 dark:text-red-400">{problem}</p>}
        {summary && <p>{summary}</p>}
        {left.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted">
            {left.slice(0, 12).map((entry) => (
              <li key={entry.key}>
                {entry.key.replace(/^(ui|email):/, "")}: {entry.problem}
              </li>
            ))}
            {left.length > 12 && <li>…and {left.length - 12} more.</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
