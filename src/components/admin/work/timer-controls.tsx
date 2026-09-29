"use client";

import type { TimerTarget } from "@/lib/work-timer-ui";

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
        Stop<span className="sr-only"> the timer on {subject}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => api.start(target)}
      disabled={disabled || api.busy}
      title={timer ? "Stops the running timer and logs its time" : undefined}
      className={`${smallButton} ${className}`}
    >
      Start<span className="sr-only"> a timer on {subject}</span>
    </button>
  );
}
