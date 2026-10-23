"use client";

import Link from "next/link";

import { timerElapsedMs } from "@/lib/work-timer-ui";
import { alertMessage } from "@/lib/work-timer-ui";
import { formatTimerClock } from "@/lib/work-time";
import { workBase } from "@/lib/work-paths";
import { STAGE_STYLES, remainingLabel, stageOf } from "@/lib/work-ui";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";
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
  const w = useAdminText("work").timer;
  const tl = useAdminText("work").labels;
  if (!api) return null;
  const { timer, now, status, error } = api;

  const estimate = timer?.estimate ?? null;
  let stage: keyof typeof STAGE_STYLES = "ok";
  let remaining = "";
  if (timer && estimate) {
    const elapsed = timerElapsedMs(timer, now);
    const left = estimate.estimatedMinutes - (estimate.loggedMinutes + Math.floor(elapsed / 60_000));
    stage = stageOf(left, estimate.settings.minutes);
    remaining = fillWords(estimate.target === "task" ? w.ofTaskEstimate : w.ofAssignmentEstimate, { left: remainingLabel(left, tl.remaining) });
  }
  const pending = timer?.key === "pending";

  return (
    <>
      <div role="status" className="sr-only">
        {status}
      </div>
      {timer && (
        <section
          aria-label={w.runningLabel}
          className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-card px-4 py-2 text-sm"
        >
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 animate-pulse rounded-full bg-positive-solid motion-reduce:animate-none"
            />
            <span
              role="timer"
              aria-label={w.clockLabel}
              className="font-mono text-base font-medium tabular-nums"
            >
              {formatTimerClock(timerElapsedMs(timer, now) / 1000)}
            </span>
          </span>
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
            <Link
              href={`${workBase(timer.storeSlug)}/assignments/${timer.assignmentId}`}
              className="font-medium underline"
            >
              {timer.taskTitle ? `${timer.taskTitle}, ${timer.assignmentName}` : timer.assignmentName}
            </Link>{" "}
            <span className="text-muted">
              {fillWords(w.forClient, { client: timer.clientName })}
              {api.showStore ? `, ${timer.storeName ?? timer.storeSlug}` : ""}
            </span>
          </span>
          {remaining && <span className={`text-xs ${STAGE_STYLES[stage].text}`}>{remaining}</span>}
          <button type="button" onClick={api.stop} disabled={pending} className={smallButton}>
            {pending ? w.starting : w.stop}
            <span className="sr-only">{w.theTimer}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(w.discardConfirm)) api.discard();
            }}
            disabled={pending}
            className="text-sm underline disabled:opacity-40"
          >
            {w.discard}<span className="sr-only">{w.theTimer}</span>
          </button>
        </section>
      )}
      {error && (
        <div
          role="alert"
          className={`mb-4 flex flex-wrap items-center gap-3 rounded-panel border border-line bg-card px-4 py-2 ${errorText}`}
        >
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={api.dismissError} className="text-sm underline">
            {w.dismiss}
          </button>
        </div>
      )}
    </>
  );
}

/** The popup half of the estimate warning: what is used up, and Stop or carry on. Sound is played by the timer itself. */
export function TimerAlertDialog() {
  const api = useWorkTimerApi();
  const w = useAdminText("work").timer;
  const tl = useAdminText("work").labels;
  if (!api) return null;
  const { alert } = api;
  const message = alert ? alertMessage(alert.stage, alert.timer, tl.alert) : null;
  return (
    <Modal
      open={alert !== null}
      onClose={api.dismissAlert}
      title={message?.title ?? w.estimate}
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
            {w.stopTheTimer}
          </button>
          <button type="button" onClick={api.dismissAlert} className={primaryButton}>
            {w.keepGoing}
          </button>
        </>
      }
    >
      <p className="text-sm">{message?.body}</p>
    </Modal>
  );
}
