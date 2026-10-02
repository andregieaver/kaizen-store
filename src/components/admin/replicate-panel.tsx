"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  ITERATIONS,
  PHASES,
  STEPS,
  clock,
  finished,
  stepStates,
  type LogLevel,
  type ReplicaJob,
  type ReplicaLogEntry,
  type ReplicaPass,
} from "@/lib/replicate";

/**
 * Copying another website's page (D150), on the AI studio's page: the owner types an address and how many times the AI
 * may improve its copy, presses Replicate, and follows the work: the steps, a bar, a live picture of the original beside the
 * copy as it grows, a log, and an Abort button. The panel keeps asking the server for the next piece of work (a tick) while
 * the page is open, and asks how it is going while a piece runs. At the end the server's summary says what went well and
 * what failed, with links to preview and edit the draft.
 */

const button = "inline-flex min-h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-50";
const primary = `${button} bg-foreground text-background`;
const secondary = `${button} border border-border hover:bg-surface`;
const card = "rounded-lg border border-border bg-background p-4";
const field = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-muted",
  ok: "text-foreground",
  warn: "text-amber-700 dark:text-amber-300",
  error: "text-red-700",
};
const LEVEL_MARK: Record<LogLevel, string> = { info: "·", ok: "✓", warn: "!", error: "✕" };

async function ask<T>(url: string, init?: RequestInit): Promise<{ ok: true; body: T } | { ok: false; problem: string }> {
  try {
    const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as (T & { problem?: string }) | null;
    if (!response.ok || body === null) return { ok: false, problem: body?.problem ?? (response.status === 504 ? "The server took too long; trying again." : "The server did not answer.") };
    return { ok: true, body };
  } catch {
    return { ok: false, problem: "The connection was lost." };
  }
}

export function ReplicatePanel({
  storeSlug,
  initial,
  pagesHref,
  aiReady,
  settingsHref,
}: {
  storeSlug: string;
  /** The store's latest job, if any, so a page opened again shows the work and carries on with it. */
  initial: ReplicaJob | null;
  /** The pages' admin address; a draft's is `${pagesHref}/${id}`. */
  pagesHref: string;
  /** Whether the site's AI has a text model, so the AI looks at the page; else the copy is made by measuring only. */
  aiReady: boolean;
  settingsHref: string;
}) {
  const base = `/admin/${storeSlug}/pages/ai/replicate`;
  const ids = useId();
  const [job, setJob] = useState<ReplicaJob | null>(initial);
  const [url, setUrl] = useState("");
  const [iterations, setIterations] = useState<number>(ITERATIONS.default);
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [now, setNow] = useState(() => Date.now());
  const driving = useRef(false);
  const mounted = useRef(true);
  const jobRef = useRef(job);
  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const active = job !== null && !finished(job.status);

  // The clock for the elapsed time.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  /** Asks for the next piece of work until the job ends, and how it is going while a piece runs. */
  const drive = useCallback(
    async (id: string) => {
      if (driving.current) return;
      driving.current = true;
      let failures = 0;
      const watch = window.setInterval(async () => {
        const status = await ask<{ job: ReplicaJob }>(`${base}/${id}`);
        if (status.ok && mounted.current) setJob(status.body.job);
      }, 1500);
      try {
        while (mounted.current) {
          const result = await ask<{ job: ReplicaJob }>(`${base}/${id}/tick`, { method: "POST", body: "{}" });
          if (!mounted.current) break;
          if (result.ok) {
            failures = 0;
            const before = jobRef.current;
            const moved = !before || before.log.length !== result.body.job.log.length || before.phase !== result.body.job.phase;
            setJob(result.body.job);
            setProblem(null);
            if (finished(result.body.job.status)) break;
            // Nothing moved: another request holds the job, or it has just stopped; ask again less eagerly.
            await new Promise((resolve) => setTimeout(resolve, moved ? 300 : 2500));
          } else {
            failures += 1;
            setProblem(result.problem);
            if (failures >= 6) break;
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
      } finally {
        window.clearInterval(watch);
        driving.current = false;
      }
    },
    [base],
  );

  // A job left standing is taken up again where it stopped.
  useEffect(() => {
    const current = jobRef.current;
    if (current && !finished(current.status)) void drive(current.id);
  }, [drive]);

  async function start(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    setStarting(true);
    const result = await ask<{ ok: boolean; job?: ReplicaJob; problem?: string }>(base, { method: "POST", body: JSON.stringify({ url, iterations, confirmed }) });
    setStarting(false);
    if (!result.ok) return setProblem(result.problem);
    if (!result.body.ok || !result.body.job) return setProblem(result.body.problem ?? "The copy could not be started.");
    setJob(result.body.job);
    void drive(result.body.job.id);
  }

  async function abort() {
    if (!job) return;
    const result = await ask<{ job: ReplicaJob }>(`${base}/${job.id}/abort`, { method: "POST", body: "{}" });
    if (result.ok) setJob(result.body.job);
    else setProblem(result.problem);
  }

  const elapsed = job ? Math.max(0, Math.round(((job.finishedAt ? new Date(job.finishedAt).getTime() : now) - new Date(job.createdAt).getTime()) / 1000)) : 0;

  return (
    <section aria-labelledby={`${ids}-title`} className={`${card} flex flex-col gap-4`}>
      <div>
        <h2 id={`${ids}-title`} className="text-lg font-semibold">
          Copy a page from another website
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Give the address of a page. The AI opens it in a browser, studies its design and layout, copies its text, downloads its pictures, videos and fonts, and rebuilds it in the page builder as a draft. Then
          it compares its copy with the original at computer and phone width and improves it, as many times as you allow.
        </p>
      </div>

      {!job && (
        <form onSubmit={start} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm font-medium" htmlFor={`${ids}-url`}>
              Address of the page
              <input id={`${ids}-url`} type="text" inputMode="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/landing-page" className={field} autoComplete="off" spellCheck={false} />
            </label>
            <label className="flex w-40 flex-col gap-1 text-sm font-medium" htmlFor={`${ids}-passes`}>
              Improving passes
              <input
                id={`${ids}-passes`}
                type="number"
                min={ITERATIONS.min}
                max={ITERATIONS.max}
                value={iterations}
                onChange={(e) => setIterations(Math.min(ITERATIONS.max, Math.max(ITERATIONS.min, Number(e.target.value) || ITERATIONS.default)))}
                className={field}
                aria-describedby={`${ids}-passes-help`}
              />
            </label>
            <button type="submit" className={primary} disabled={starting || !confirmed || url.trim() === ""}>
              {starting ? "Starting…" : "Replicate"}
            </button>
          </div>
          <p id={`${ids}-passes-help`} className="text-xs text-muted">
            Each pass takes a minute or two and compares the copy with the original, then fixes what differs ({ITERATIONS.min}–{ITERATIONS.max}). More passes are closer, and take longer.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
            <span>
              I have the right to copy this page&apos;s text, pictures and design (it is mine, or I have its owner&apos;s permission). The copy is saved as a draft and is not published or shown to search engines until I decide.
            </span>
          </label>
          {!aiReady && (
            <p className="text-sm text-muted">
              The site has no AI text model, so the copy is made by measuring alone, without the AI looking at it.{" "}
              <Link href={settingsHref} className="underline">
                Set up the AI
              </Link>
              .
            </p>
          )}
        </form>
      )}

      {problem && (
        <p role="alert" className="rounded-md border border-red-700/40 bg-red-700/5 p-3 text-sm text-red-700">
          {problem}
        </p>
      )}

      {job && (
        <div className="flex flex-col gap-4">
          <Progress job={job} elapsed={elapsed} onAbort={abort} />
          <Stepper job={job} />
          <Preview job={job} view={view} setView={setView} />
          {job.summary ? <Summary job={job} pagesHref={pagesHref} /> : null}
          <Log log={job.log} />
          {finished(job.status) && (
            <div>
              <button type="button" className={secondary} onClick={() => setJob(null)}>
                Copy another page
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Progress({ job, elapsed, onAbort }: { job: ReplicaJob; elapsed: number; onAbort: () => void }) {
  const done = finished(job.status);
  const label = job.status === "done" ? "Finished" : job.status === "failed" ? "Stopped with a problem" : job.status === "aborted" ? "Aborted" : job.abortRequested ? "Stopping…" : STEPS[job.phase];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={job.url}>
            {job.url}
          </p>
          <p className="text-xs text-muted" aria-live="polite">
            {label}
            {job.phase === "refine" && !done ? ` · pass ${Math.min(job.iteration, job.iterationsMax)} of ${job.iterationsMax}` : ""} · {minutes(elapsed)}
          </p>
        </div>
        {!done && (
          <button type="button" onClick={onAbort} disabled={job.abortRequested} className={`${secondary} border-red-700/50 text-red-700`}>
            {job.abortRequested ? "Stopping…" : "Abort"}
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.progress}
        aria-label="Progress of the copy"
        className="h-2.5 overflow-hidden rounded-full bg-surface"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${job.status === "failed" ? "bg-red-700" : job.status === "aborted" ? "bg-amber-600" : "bg-foreground"}`}
          style={{ width: `${job.progress}%` }}
        />
      </div>
      <p className="text-sm" aria-live="polite">
        {job.doing}
      </p>
    </div>
  );
}

function Stepper({ job }: { job: ReplicaJob }) {
  const states = stepStates(job);
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {PHASES.filter((phase) => phase !== "done").map((phase, index) => {
        const state = states[phase];
        return (
          <li key={phase} className={`flex items-center gap-1.5 ${state === "waiting" ? "text-muted" : state === "stopped" ? "text-amber-700" : ""}`} aria-current={state === "active" ? "step" : undefined}>
            <span
              aria-hidden
              className={`grid size-5 place-items-center rounded-full border text-[11px] ${
                state === "done" ? "border-foreground bg-foreground text-background" : state === "active" ? "border-foreground" : "border-border"
              }`}
            >
              {state === "done" ? "✓" : index + 1}
            </span>
            <span className={state === "active" ? "font-medium" : ""}>{STEPS[phase]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ScoreChips({ passes, view }: { passes: ReplicaPass[]; view: "desktop" | "mobile" }) {
  const values = passes.map((pass) => ({ iteration: pass.iteration, match: view === "desktop" ? pass.desktop.match : (pass.mobile?.match ?? null) }));
  if (values.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 text-xs" aria-label="Match with the original after each pass">
      {values.map((value) => (
        <li key={value.iteration} className="rounded-full border border-border px-2 py-0.5">
          {value.iteration === 0 ? "First copy" : `Pass ${value.iteration}`}: <strong>{value.match === null ? "–" : `${value.match}%`}</strong>
        </li>
      ))}
    </ul>
  );
}

/** The original beside the copy as it is now; scrolling one scrolls the other. */
function Preview({ job, view, setView }: { job: ReplicaJob; view: "desktop" | "mobile"; setView: (view: "desktop" | "mobile") => void }) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);
  const original = job.previews.original[view];
  const copy = job.previews.copy[view];
  const last = job.passes[job.passes.length - 1];
  const score = last ? (view === "desktop" ? last.desktop : last.mobile) : null;
  if (!original && !copy) return null;

  const follow = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => (syncing.current = false));
  };
  const shown = view === "desktop" ? "min-w-0 flex-1" : "w-[220px] shrink-0";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Live preview</h3>
        <div role="group" aria-label="Width" className="inline-flex overflow-hidden rounded-md border border-border text-sm">
          {(["desktop", "mobile"] as const).map((name) => (
            <button key={name} type="button" onClick={() => setView(name)} aria-pressed={view === name} className={`px-3 py-1.5 ${view === name ? "bg-foreground text-background" : "hover:bg-surface"}`}>
              {name === "desktop" ? "Computer" : "Phone"}
            </button>
          ))}
        </div>
      </div>
      <ScoreChips passes={job.passes} view={view} />
      <div className={`flex gap-3 ${view === "mobile" ? "justify-center" : ""}`}>
        <figure className={`flex flex-col gap-1 ${shown}`}>
          <figcaption className="text-xs font-medium text-muted">Original</figcaption>
          <div ref={left} onScroll={() => follow(left.current, right.current)} className="h-[520px] overflow-auto rounded-md border border-border bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element -- a photograph of another site's page, drawn at its own size */}
            {original ? <img src={original} alt="The original page" className="block w-full" /> : <Empty text="Not looked at yet" />}
          </div>
        </figure>
        <figure className={`flex flex-col gap-1 ${shown}`}>
          <figcaption className="text-xs font-medium text-muted">
            Copy{job.previews.copy.iteration !== null ? (job.previews.copy.iteration === 0 ? " — first build" : ` — after pass ${job.previews.copy.iteration}`) : ""}
            {score ? ` · ${score.match}% match` : ""}
          </figcaption>
          <div ref={right} onScroll={() => follow(right.current, left.current)} className="h-[520px] overflow-auto rounded-md border border-border bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element -- a photograph of the draft, drawn at its own size */}
            {copy ? <img src={copy} alt="The copy as it is now" className="block w-full" /> : <Empty text={finished(job.status) ? "No copy was made" : "The copy appears here once it is built"} />}
          </div>
        </figure>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="grid h-full min-h-40 place-items-center p-4 text-center text-xs text-muted">{text}</p>;
}

function Summary({ job, pagesHref }: { job: ReplicaJob; pagesHref: string }) {
  const summary = job.summary!;
  const tone = summary.outcome === "done" ? "border-border" : "border-amber-600/50";
  return (
    <div className={`flex flex-col gap-3 rounded-lg border ${tone} bg-surface p-4`} aria-labelledby={`${job.id}-summary`}>
      <h3 id={`${job.id}-summary`} className="text-base font-semibold">
        {summary.outcome === "done" ? "Summary" : summary.outcome === "aborted" ? "Summary of what was done before it was stopped" : "The copy could not be finished"}
      </h3>
      {summary.finalMatch.desktop !== null && (
        <p className="text-sm">
          Match with the original: <strong>{summary.finalMatch.desktop}%</strong> on computers
          {summary.finalMatch.mobile !== null ? (
            <>
              , <strong>{summary.finalMatch.mobile}%</strong> on phones
            </>
          ) : null}
          .
        </p>
      )}
      {summary.wentWell.length > 0 && (
        <div>
          <h4 className="text-sm font-medium">What went well</h4>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {summary.wentWell.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-green-700">
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.problems.length > 0 && (
        <div>
          <h4 className="text-sm font-medium">What failed or is not as it was</h4>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {summary.problems.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-amber-700">
                  !
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.page ? (
        <div className="flex flex-wrap gap-2">
          <Link href={`${pagesHref}/${summary.page.id}/preview`} className={primary} target="_blank">
            Preview the copy
          </Link>
          <Link href={`${pagesHref}/${summary.page.id}`} className={secondary}>
            Open it in the page builder
          </Link>
        </div>
      ) : null}
      <p className="text-xs text-muted">The copy is a draft: its address, search texts and links are the original&apos;s, and it is hidden from search engines until you publish it. Its text is the original&apos;s and may need to be changed to be yours.</p>
    </div>
  );
}

function Log({ log }: { log: ReplicaLogEntry[] }) {
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  if (log.length === 0) return null;
  return (
    <details open className="rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">What the AI is doing</summary>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="max-h-64 overflow-auto border-t border-border px-3 py-2 font-mono text-xs"
      >
        {log.map((entry, index) => (
          <p key={`${entry.at}-${index}`} className={`flex gap-2 py-0.5 ${LEVEL_STYLE[entry.level]}`}>
            <span className="shrink-0 text-muted">{clock(entry.at)}</span>
            <span aria-hidden className="w-3 shrink-0 text-center">
              {LEVEL_MARK[entry.level]}
            </span>
            <span className="min-w-0 break-words">{entry.text}</span>
          </p>
        ))}
      </div>
    </details>
  );
}
