import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { challengeOn, readChallenge, utcDay, type Challenge } from "@/lib/autopilot-challenge";
import { versionChanges, withLog, type Versions } from "@/lib/challenge-pin";

import { promptVersions, toolsVersion } from "./agent-eval";
import { getAiSettings } from "./ai";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";
import { jobReport } from "./cache-events";

/**
 * Challenge stores protected from deploys (`docs/100-day-challenge.md` F5): what each one's AI runs on is pinned when the challenge is set,
 * the dispatcher's watch (`watchChallengeVersions()`, job `challengeVersions`) logs every change after a deploy on the challenge itself, and
 * the deploy's smoke requests each challenge store's pages (`challenge-smoke.ts`). Never throws.
 */

/** What a store's AI runs on now: the agents' prompt versions, the tools' version and its text model (its own, else the platform's). */
export async function currentVersions(storeId: string): Promise<Versions> {
  const settings = (await getAiSettings(storeId)) ?? (await getAiSettings(null));
  return {
    prompts: { ...promptVersions() },
    tools: toolsVersion(),
    model: settings?.textModel ? `${settings.provider}/${settings.textModel}` : null,
  };
}

/** Writes the challenge's records as they are, with no audit of its own: the pin and the log are the platform's notes on it. */
const writeChallenge = (storeId: string, c: Challenge) =>
  db().execute(sql`update commerce.autopilot_settings set challenge = ${JSON.stringify(c)}::jsonb, updated_at = now() where store_id = ${storeId}::uuid`);

/** Pins what the store's AI runs on now, unless it is pinned already. Returns the challenge as written, or null without one. */
export async function pinChallenge(storeId: string, challenge: Challenge, now: Date = new Date()): Promise<Challenge> {
  if (challenge.pinned) return challenge;
  const versions = await currentVersions(storeId);
  const pinned: Challenge = { ...challenge, pinned: { ...versions, at: now.toISOString() }, seen: versions };
  await writeChallenge(storeId, pinned);
  return pinned;
}

const ROW = z.object({ store_id: col.uuid, challenge: z.unknown() });

/**
 * The watch (F5): for each store with challenge mode on, what its AI runs on now against what was seen last; each change is logged on the
 * challenge with the time, and what is seen moves on. A store not pinned yet is pinned. Returns the changes logged.
 */
export async function watchChallengeVersions(now: Date = new Date()): Promise<number> {
  const report = jobReport();
  let logged = 0;
  try {
    const rows = await typedRows(ROW, sql`select store_id, challenge from commerce.autopilot_settings where challenge is not null`);
    for (const row of rows) {
      const challenge = readChallenge(row.challenge);
      if (!challengeOn(challenge, utcDay(now))) continue;
      if (!challenge.pinned) {
        await pinChallenge(row.store_id, challenge, now);
        continue;
      }
      const versions = await currentVersions(row.store_id);
      const changes = versionChanges(challenge.seen ?? challenge.pinned, versions);
      if (changes.length === 0) continue;
      await writeChallenge(row.store_id, { ...challenge, seen: versions, versionLog: withLog(challenge.versionLog, now.toISOString(), changes) });
      log("info", "challenge.versions_changed", { storeId: row.store_id, changes: changes.length });
      logged += changes.length;
    }
  } catch (error) {
    report(error, "version-watch");
    log("error", "challenge.version_watch_failed", {}, error);
  }
  return logged;
}
