import "server-only";

/**
 * Runs `run` after the answer, as `after()` does in a request; outside one (a job, a test) it does nothing, and the five-minute job picks the
 * work up. For tools that start work the owner does not wait for (D315: invoicing a domain).
 */
export function afterAnswer(run: () => Promise<unknown>): void {
  void import("next/server")
    .then(({ after }) => {
      try {
        after(run);
      } catch {
        // Not in a request: the five-minute job does it.
      }
    })
    .catch(() => undefined);
}
