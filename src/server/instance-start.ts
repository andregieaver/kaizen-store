import { instanceStartFields, type InstanceKind } from "@/lib/instance-start";

import { log } from "./log";

/**
 * A cold start, noted once (bloat review step 1.16). The first call after an instance starts writes one log line and one row (what it was
 * started for, times, memory and the bytes of translated text read at start) after its answer; every later call is one boolean test. The
 * beacons and the proxy import this file, so it imports nothing heavy (the database client is read only inside the work, after the answer) and
 * takes no information about the visit: it cannot write what it is never given.
 */

const KEY = "__kaizenInstanceStart" as const;

type Start = { registerMs: number | null; uiBytes: number; noted: boolean };

function start(): Start {
  const scope = globalThis as { __kaizenInstanceStart?: Start };
  return (scope[KEY] ??= { registerMs: null, uiBytes: 0, noted: false });
}

/** Called by `register()` when it is done: the milliseconds since the process started, and the translated text read at start. */
export function markRegistered(uiBytes: number): void {
  const s = start();
  s.registerMs = Math.round(process.uptime() * 1000);
  s.uiBytes = uiBytes;
}

/**
 * The first answer of an instance. `later` runs work after the answer: Next's `after` in a route or a server component, the proxy's
 * `event.waitUntil`. Never throws.
 */
export function noteFirstRequest(kind: InstanceKind, later: (work: () => Promise<void>) => void): void {
  const s = start();
  if (s.noted) return;
  s.noted = true;
  try {
    later(async () => {
      const fields = instanceStartFields(kind, {
        registerMs: s.registerMs,
        firstMs: Math.round(process.uptime() * 1000),
        rssBytes: process.memoryUsage().rss,
        uiBytes: s.uiBytes,
      });
      log("info", "instance.start", fields);
      try {
        const { db } = await import("@/db/client");
        const { sql } = await import("drizzle-orm");
        await db().execute(
          sql`insert into commerce.instance_starts (day, kind, register_ms, first_ms, rss_mb, ui_bytes) values ((now() at time zone 'utc')::date, ${fields.kind}, ${fields.registerMs}, ${fields.firstMs}, ${fields.rssMb}, ${fields.uiBytes})`,
        );
      } catch (error) {
        log("warn", "instance.start_not_stored", {}, error);
      }
    });
  } catch (error) {
    log("warn", "instance.start_not_stored", {}, error);
  }
}
