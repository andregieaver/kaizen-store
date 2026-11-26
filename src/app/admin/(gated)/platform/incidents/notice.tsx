import type { AdminUseMessages } from "@/lib/admin-messages/admin-use.en";
import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

type W = PlatformMessages["incidents"];

/** Where the incidents pages' forms post (D895): a route, so the pages add no server action. */
export const INCIDENT_ACT = "/admin/platform/incidents/act";

/** What the last post did, from the address the route sent the page back to: done, or the problem in words. */
export function IncidentNotice({ query, w, use }: { query: Record<string, string | string[] | undefined>; w: W; use?: AdminUseMessages["platform"] }) {
  const done = typeof query.done === "string" ? query.done : null;
  const problem = typeof query.problem === "string" ? query.problem : null;
  const done_: Record<string, string> = { idea: w.idea.saved, settings: w.autopilot.saved, moved: w.moved, run_now: w.autopilot.runNowDone };
  if (use) Object.assign(done_, { signals_open: use.opened, signals_close: use.closed });
  const problems_: Record<string, string> = { ...w.problems };
  if (use) Object.assign(problems_, { signals_locked: use.problems.locked, signals_signed: use.problems.signed });
  const said = (done && done_[done]) || (problem && problems_[problem]) || null;
  if (!said) return null;
  return (
    <p role="status" className={`rounded-panel border border-line bg-card p-4 text-sm ${problem ? "text-danger-text" : "text-ink"}`}>
      {said}
    </p>
  );
}
