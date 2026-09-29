"use client";

import Link from "next/link";

import { timerElapsedMs } from "@/lib/work-timer-ui";
import { alertMessage } from "@/lib/work-timer-ui";
import { formatTimerClock } from "@/lib/work-time";
import { STAGE_STYLES, remainingLabel, stageOf } from "@/lib/work-ui";

import { useWorkTimerApi } from "./timer-context";
import { primaryButton, smallButton, errorText } from "./work-parts";
import { Modal } from "../modal";

/**
 * The running timer, at the top of every Work page: the clock, what it is
 * running on, what is left of its estimate, and Stop. Nothing is drawn while no
 * timer runs, except the notes a press leaves (a live region for the reader
 * of a screen, and a message when a press did not work).
 */
export function TimerBar() {
  const api = useWorkTimerApi();
  if (!api) return null;
  const { timer, now, status, error } = api;

  const estimate = timer?.estimate ?? null;
  let stage: keyof typeof STAGE_STYLES = "ok";
  let remaining = "";
  if (timer && estimate) {
    const elapsed = timerElapsedMs(timer, now);
    const left = estimate.estimatedMinutes - (estimate.loggedMinutes + Math.floor(elapsed / 60_000));
    stage = stageOf(left, estimate.settings.minutes);
    remaining = `${remainingLabel(left)} of the ${estimate.target === "task" ? "task's" : "assignment's"} estimate`;
  }
  const pending = timer?.key === "pending";

  return (
    <>
      <div role="status" className="sr-only">
        {status}
      </div>
      {timer && (
        <section
          aria-label="Running timer"
          className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background px-4 py-2 text-sm"
        >
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 animate-pulse rounded-full bg-emerald-600 motion-reduce:animate-none"
            />
            <span
              role="timer"
              aria-label="Time on the running timer"
              className="font-mono text-base font-semibold tabular-nums"
            >
              {formatTimerClock(timerElapsedMs(timer, now) / 1000)}
            </span>
          </span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <Link
              href={`/admin/${api.storeSlug}/work/assignments/${timer.assignmentId}`}
              className="font-medium underline"
            >
              {timer.taskTitle ? `${timer.taskTitle}, ${timer.assignmentName}` : timer.assignmentName}
            </Link>{" "}
            <span className="text-muted">for {timer.clientName}</span>
          </span>
          {remaining && <span className={`text-xs ${STAGE_STYLES[stage].text}`}>{remaining}</span>}
          <button type="button" onClick={api.stop} disabled={pending} className={smallButton}>
            {pending ? "Starting …" : "Stop"}
            <span className="sr-only"> the timer</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Discard this timer? The time it has counted is not logged.")) api.discard();
            }}
            disabled={pending}
            className="text-sm underline disabled:opacity-40"
          >
            Discard<span className="sr-only"> the timer</span>
          </button>
        </section>
      )}
      {error && (
        <div
          role="alert"
          className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-4 py-2 ${errorText}`}
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={api.dismissError} className="text-sm underline">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** The popup half of the estimate warning: what is used up, and Stop or carry on. Sound is played by the timer itself. */
export function TimerAlertDialog() {
  const api = useWorkTimerApi();
  if (!api) return null;
  const { alert } = api;
  const message = alert ? alertMessage(alert.stage, alert.timer) : null;
  return (
    <Modal
      open={alert !== null}
      onClose={api.dismissAlert}
      title={message?.title ?? "Estimate"}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              api.dismissAlert();
              api.stop();
            }}
            className={smallButton}
          >
            Stop the timer
          </button>
          <button type="button" onClick={api.dismissAlert} className={primaryButton}>
            Keep going
          </button>
        </>
      }
    >
      <p className="text-sm">{message?.body}</p>
    </Modal>
  );
}
