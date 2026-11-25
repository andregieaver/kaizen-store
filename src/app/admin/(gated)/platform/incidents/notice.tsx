import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

type W = PlatformMessages["incidents"];

/** Where the incidents pages' forms post (D895): a route, so the pages add no server action. */
export const INCIDENT_ACT = "/admin/platform/incidents/act";

/** What the last post did, from the address the route sent the page back to: done, or the problem in words. */
export function IncidentNotice({ query, w }: { query: Record<string, string | string[] | undefined>; w: W }) {
  const done = typeof query.done === "string" ? query.done : null;
  const problem = typeof query.problem === "string" ? query.problem : null;
  const said =
    done === "idea"
      ? w.idea.saved
      : done === "settings"
        ? w.autopilot.saved
        : done === "moved"
          ? w.moved
          : problem && problem in w.problems
            ? w.problems[problem as keyof W["problems"]]
            : null;
  if (!said) return null;
  return (
    <p role="status" className={`rounded-panel border border-line bg-card p-4 text-sm ${problem ? "text-danger-text" : "text-ink"}`}>
      {said}
    </p>
  );
}
