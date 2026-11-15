import { z } from "zod";

/**
 * What a challenge store's AI runs on (`docs/100-day-challenge.md` F5): each agent's prompt version (D391), the tools' version and the text
 * model, pinned when the challenge is set. During the run a change to any of them is a platform fix: the watch finds it after each deploy and
 * logs it on the challenge, so the referee sees every change to the contestant's brain. Pure: the shapes and the comparison.
 */

export const versionsSchema = z.object({
  prompts: z.record(z.string(), z.string()),
  tools: z.string(),
  /** `provider/model` of the text model the store's AI uses; null when none is set. */
  model: z.string().nullable(),
});
export type Versions = z.output<typeof versionsSchema>;

export const pinnedSchema = versionsSchema.extend({ at: z.string() });
export type Pinned = z.output<typeof pinnedSchema>;

export const versionLogEntry = z.object({ at: z.string(), what: z.string().max(300) });
export type VersionLogEntry = z.output<typeof versionLogEntry>;

/** The most changes kept on a challenge; the oldest go first. */
export const VERSION_LOG_MAX = 200;

/** Each difference between what was seen and what runs now, in words: a prompt, the tools or the model, from one version to the other. */
export function versionChanges(seen: Versions, now: Versions): string[] {
  const changes: string[] = [];
  for (const agent of [...new Set([...Object.keys(seen.prompts), ...Object.keys(now.prompts)])].sort()) {
    const before = seen.prompts[agent] ?? "none";
    const after = now.prompts[agent] ?? "none";
    if (before !== after) changes.push(`The ${agent} prompt changed from ${before} to ${after}.`);
  }
  if (seen.tools !== now.tools) changes.push(`The tools changed from ${seen.tools} to ${now.tools}.`);
  if (seen.model !== now.model) changes.push(`The text model changed from ${seen.model ?? "none"} to ${now.model ?? "none"}.`);
  return changes;
}

/** The log with new entries added at the end, keeping the newest `VERSION_LOG_MAX`. */
export function withLog(log: readonly VersionLogEntry[], at: string, changes: readonly string[]): VersionLogEntry[] {
  return [...log, ...changes.map((what) => ({ at, what }))].slice(-VERSION_LOG_MAX);
}
