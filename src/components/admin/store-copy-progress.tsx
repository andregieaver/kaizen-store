"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { copiedStoreAdminPath, copiedStoreSetupPath, copyWizardPath } from "@/lib/store-copy-paths";
import { countRows, phaseSteps, pollDelay } from "@/lib/store-copy-progress";
import { type StoreCopyActions, type StoreCopyProgress as Progress } from "@/lib/store-copy";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";

const linkButton = "inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium";
const MARKS = { done: "✓", current: "→", waiting: "○", stopped: "✕" } as const;

/**
 * A copy's progress, drawn (D129). Only the words and the native `<progress>` change: no spinner or motion, so it
 * reads the same with reduced motion. The status line is the one live region (polite).
 */
export function StoreCopyProgressView({ progress, trouble = false }: { progress: Progress; trouble?: boolean }) {
  const { status } = progress;
  const w = useAdminText("platform").copyProgress;
  const lang = useAdminLang();
  const num = (n: number) => n.toLocaleString(lang === "en" ? "en" : ADMIN_LANG_FACTS[lang].locale);
  const rows = countRows(progress.counts);
  const steps = phaseSteps(progress);
  const heading =
    status === "done"
      ? w.ready
      : status === "failed"
        ? w.failed
        : fillWords(w.copying, { source: progress.sourceName, name: progress.newName });
  const line =
    status === "done"
      ? fillWords(w.copied, { name: progress.newName, source: progress.sourceName })
      : status === "failed"
        ? w.stopped
        : `${w.phases[progress.phase]} …`;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <PageHeader title={<>{heading}</>} />
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {line}
        </p>
      </div>

      {trouble && status === "running" && (
        <p className={`p-3 text-sm ${CARD_CLASS}`}>
          {w.trouble}
        </p>
      )}

      {status === "failed" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-danger-text p-4 text-sm"
        >
          <p className="font-medium text-danger-text">
            {progress.problem ?? w.wrong}
          </p>
          <p>
            {w.youCan}{" "}
            <Link href={copyWizardPath(progress.sourceSlug)} className="underline underline-offset-2">
              {w.startNew}
            </Link>
            {w.partly}
          </p>
        </div>
      )}

      {status === "done" && (
        <section
          aria-labelledby="copy-next"
          className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}
        >
          <h2 id="copy-next" className="text-title text-ink">
            {w.next}
          </h2>
          <p className="text-sm text-muted">
            {w.nextNote}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={copiedStoreAdminPath(progress.newSlug)}
              className={`${linkButton} bg-brand text-brand-ink`}
            >
              {fillWords(w.open, { name: progress.newName })}
            </Link>
            <Link href={copiedStoreSetupPath(progress.newSlug)} className={`${linkButton} border border-line`}>
              {w.continue}
            </Link>
            <Link href="/admin/stores" className={`${linkButton} border border-line`}>
              {w.allStores}
            </Link>
          </div>
        </section>
      )}

      <section aria-labelledby="copy-steps" className="flex flex-col gap-2">
        <h2 id="copy-steps" className="text-title text-ink">
          {w.steps}
        </h2>
        <ol className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
          {steps.map((step) => (
            <li
              key={step.phase}
              aria-current={step.state === "current" ? "step" : undefined}
              className="flex items-center gap-3 p-3"
            >
              <span aria-hidden className="w-4 text-center">
                {MARKS[step.state]}
              </span>
              <span className={step.state === "waiting" ? "flex-1 text-muted" : "flex-1"}>{w.phases[step.phase]}</span>
              <span className="text-muted">{w.states[step.state]}</span>
            </li>
          ))}
        </ol>
      </section>

      {rows.length > 0 && (
        <section aria-labelledby="copy-counts" className="flex flex-col gap-2">
          <h2 id="copy-counts" className="text-title text-ink">
            {w.whatCopied}
          </h2>
          <ul className={`flex flex-col gap-3 p-4 text-sm ${CARD_CLASS}`}>
            {rows.map((row) => (
              <li key={row.key} className="flex flex-col gap-1">
                <span className="flex justify-between gap-3">
                  <span id={`copy-count-${row.key}`}>{w.counts[row.key]}</span>
                  <span>{fillWords(w.of, { done: num(row.done), total: num(row.total) })}</span>
                </span>
                <progress
                  value={row.done}
                  max={row.total}
                  aria-labelledby={`copy-count-${row.key}`}
                  className="h-2 w-full"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {progress.mediaLeftOut > 0 && (
        <p className={`p-3 text-sm ${CARD_CLASS}`}>
          {countWords(progress.mediaLeftOut, w.leftOut, { n: num(progress.mediaLeftOut) })}
        </p>
      )}
    </div>
  );
}

/** The progress page's live part: asks for the copy's progress at once and every few seconds while it runs. */
export function StoreCopyProgress({
  id,
  progress: first,
  read,
}: {
  id: string;
  progress: Progress;
  read: StoreCopyActions["progress"];
}) {
  const [progress, setProgress] = useState(first);
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    let stopped = progress.status !== "running";
    let timer: number | undefined;
    let misses = 0;

    const ask = async () => {
      window.clearTimeout(timer);
      if (stopped || document.hidden) return;
      try {
        const result = await read(id);
        if (stopped) return;
        if (result.ok) {
          misses = 0;
          setFailures(0);
          setProgress(result.progress);
          if (result.progress.status !== "running") stopped = true;
        } else misses += 1;
      } catch {
        misses += 1;
      }
      if (stopped) return;
      setFailures(misses);
      timer = window.setTimeout(ask, pollDelay(misses));
    };
    // A hidden tab waits; coming back asks at once.
    const shown = () => {
      if (!document.hidden) void ask();
      else window.clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", shown);
    void ask();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
    };
    // Only the first status decides whether to start: later ones come from the loop itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, read]);

  return <StoreCopyProgressView progress={progress} trouble={failures >= 2} />;
}
