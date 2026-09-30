"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { copiedStoreAdminPath, copiedStoreSetupPath, copyWizardPath } from "@/lib/store-copy-paths";
import { PHASE_STATE_WORDS, countRows, countText, leftOutText, phaseSteps, pollDelay } from "@/lib/store-copy-progress";
import { COPY_PHASE_LABELS, type StoreCopyActions, type StoreCopyProgress as Progress } from "@/lib/store-copy";

const linkButton = "inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium";
const MARKS = { done: "✓", current: "→", waiting: "○", stopped: "✕" } as const;

/**
 * A copy's progress, drawn (D129). Only the words and the native `<progress>` change: no spinner or motion, so it
 * reads the same with reduced motion. The status line is the one live region (polite).
 */
export function StoreCopyProgressView({ progress, trouble = false }: { progress: Progress; trouble?: boolean }) {
  const { status } = progress;
  const rows = countRows(progress.counts);
  const steps = phaseSteps(progress);
  const heading =
    status === "done"
      ? "Your new store is ready"
      : status === "failed"
        ? "The copy did not finish"
        : `Copying ${progress.sourceName} to ${progress.newName}`;
  const line =
    status === "done"
      ? `${progress.newName} has been copied from ${progress.sourceName}.`
      : status === "failed"
        ? "The copy stopped."
        : `${COPY_PHASE_LABELS[progress.phase]} …`;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {line}
        </p>
      </div>

      {trouble && status === "running" && (
        <p className="rounded-lg border border-border bg-background p-3 text-sm">
          The latest news could not be fetched. The copy carries on in the background, and this page keeps trying.
        </p>
      )}

      {status === "failed" && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-700 p-4 text-sm dark:border-red-400"
        >
          <p className="font-medium text-red-700 dark:text-red-400">
            {progress.problem ?? "Something went wrong while copying."}
          </p>
          <p>
            You can{" "}
            <Link href={copyWizardPath(progress.sourceSlug)} className="underline underline-offset-2">
              start a new copy
            </Link>
            . The new store may be partly there. It stays closed, so nobody can see it.
          </p>
        </div>
      )}

      {status === "done" && (
        <section
          aria-labelledby="copy-next"
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
        >
          <h2 id="copy-next" className="font-medium">
            What next
          </h2>
          <p className="text-sm text-muted">
            The new store is closed until you open it. Look it over, then finish its setup.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={copiedStoreAdminPath(progress.newSlug)}
              className={`${linkButton} bg-foreground text-background`}
            >
              Open {progress.newName}
            </Link>
            <Link href={copiedStoreSetupPath(progress.newSlug)} className={`${linkButton} border border-border`}>
              Continue setup
            </Link>
            <Link href="/admin/stores" className={`${linkButton} border border-border`}>
              All stores
            </Link>
          </div>
        </section>
      )}

      <section aria-labelledby="copy-steps" className="flex flex-col gap-2">
        <h2 id="copy-steps" className="font-medium">
          Steps
        </h2>
        <ol className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
          {steps.map((step) => (
            <li
              key={step.phase}
              aria-current={step.state === "current" ? "step" : undefined}
              className="flex items-center gap-3 p-3"
            >
              <span aria-hidden className="w-4 text-center">
                {MARKS[step.state]}
              </span>
              <span className={step.state === "waiting" ? "flex-1 text-muted" : "flex-1"}>{step.label}</span>
              <span className="text-muted">{PHASE_STATE_WORDS[step.state]}</span>
            </li>
          ))}
        </ol>
      </section>

      {rows.length > 0 && (
        <section aria-labelledby="copy-counts" className="flex flex-col gap-2">
          <h2 id="copy-counts" className="font-medium">
            What is copied
          </h2>
          <ul className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-sm">
            {rows.map((row) => (
              <li key={row.key} className="flex flex-col gap-1">
                <span className="flex justify-between gap-3">
                  <span id={`copy-count-${row.key}`}>{row.label}</span>
                  <span>{countText(row)}</span>
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
        <p className="rounded-lg border border-border bg-background p-3 text-sm">
          {leftOutText(progress.mediaLeftOut)}
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
