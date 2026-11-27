import "server-only";

import type { DrainError } from "@/lib/drain-errors";

import { logIncident } from "./incidents";
import { log } from "./log";

/**
 * Runtime errors from the log drain into the incident log (D895 IA-17): one entry per fingerprint, as the autopilot's runbook pulls them by
 * hand, so the two meet one row; a repeat only counts (`logIncident()`), and a new or returning one wakes the autopilot. Never throws: the
 * drain's usage counting must not fail for this.
 */
export async function logDrainErrors(errors: readonly DrainError[]): Promise<number> {
  let logged = 0;
  for (const e of errors) {
    try {
      const row = await logIncident({
        kind: e.kind,
        source: "runtime",
        fingerprint: e.fingerprint,
        title: e.title,
        facts: { route: e.route, name: e.name, message: e.message, count: e.count, ...(e.deployment ? { deployment: e.deployment } : {}) },
      });
      if (row) logged += 1;
    } catch (error) {
      // A warning, not an error: the drain would bring an error line back here.
      log("warn", "drain.incident_failed", {}, error);
    }
  }
  return logged;
}
