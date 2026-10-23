"use client";

import type { TimerTarget } from "@/lib/work-timer-ui";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";
import { useWorkTimerApi } from "./timer-context";
import { smallButton } from "./work-parts";

/**
 * Start or stop the person's timer on an assignment, or on one of its tasks.
 * Starting while another timer runs stops and logs that one first (one timer
 * per person), which the button says when it is pressed on something else.
 * Draws nothing where there is no timer to talk to.
 */
export function TimerToggle({
  target,
  subject,
  className = "",
  disabled = false,
}: {
  target: TimerTarget;
  /** What it is on, for the button's name: the task's or assignment's name. */
  subject: string;
  className?: string;
  disabled?: boolean;
}) {
  const api = useWorkTimerApi();
  const w = useAdminText("work").timer;
  if (!api) return null;
  const { timer } = api;
  const running = timer !== null && timer.assignmentId === target.assignmentId && timer.taskId === target.taskId;
  if (running) {
    return (
      <button
        type="button"
        onClick={api.stop}
        disabled={timer.key === "pending"}
        className={`${smallButton} ${className}`}
      >
        {w.stop}<span className="sr-only">{fillWords(w.stopOn, { subject })}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => api.start(target)}
      disabled={disabled || api.busy}
      title={timer ? w.stopsRunning : undefined}
      className={`${smallButton} ${className}`}
    >
      {w.start}<span className="sr-only">{fillWords(w.startOn, { subject })}</span>
    </button>
  );
}
