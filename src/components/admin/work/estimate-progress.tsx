"use client";

import { liveMinutes } from "@/lib/work-timer-ui";
import { STAGE_STYLES, progressView } from "@/lib/work-ui";
import { formatDuration } from "@/lib/work-time";

import { useWorkTimerApi } from "./timer-context";

/**
 * Logged time against an assignment's estimate: a bar that is green while on
 * track, amber once less than the warning threshold is left and red when
 * used up, with the words to say so (colour is never the only sign). While
 * the person's timer runs on the assignment, its whole minutes count, so the
 * figures move with the clock; a stopped timer's minutes count until the
 * server's own figures include them.
 */
export function EstimateProgress({
  assignmentId,
  loggedMinutes,
  estimatedMinutes,
  alertMinutes,
}: {
  assignmentId: string;
  /** What the server had logged, without a running timer. */
  loggedMinutes: number;
  estimatedMinutes: number | null;
  alertMinutes: number | null;
}) {
  const api = useWorkTimerApi();
  const live = api ? liveMinutes(api.timer, api.pendingEntry, api.now, { assignmentId }) : 0;
  const logged = loggedMinutes + live;
  const view = progressView(logged, estimatedMinutes, alertMinutes);
  const style = STAGE_STYLES[view.stage];
  const running = api?.timer?.assignmentId === assignmentId;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span>
          <span className="font-medium tabular-nums">{formatDuration(logged)}</span> logged
          {estimatedMinutes != null && (
            <>
              {" "}
              of <span className="tabular-nums">{formatDuration(estimatedMinutes)}</span> estimated
            </>
          )}
          {running && <span className="text-muted"> (timer running)</span>}
        </span>
        {view.percent !== null && (
          <span className={`tabular-nums ${style.text}`}>
            {view.label}, {view.percent} %
          </span>
        )}
      </div>
      {view.percent !== null ? (
        <div
          role="progressbar"
          aria-label="Time used of the estimate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, view.percent)}
          aria-valuetext={`${view.percent} % used. ${style.name}. ${view.label}`}
          className="h-2 w-full overflow-hidden rounded-full bg-surface"
        >
          <div className={`h-full ${style.bar}`} style={{ width: `${view.fill}%` }} />
        </div>
      ) : (
        <p className="text-xs text-muted">No estimate. Add one to the assignment to see how much is left.</p>
      )}
    </div>
  );
}
