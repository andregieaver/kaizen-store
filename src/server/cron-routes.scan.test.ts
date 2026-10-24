import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every cron route has a time limit and keeps its runs in `commerce.cron_jobs` (PSI 2026-10-24, REL-06), so one that stops or keeps
 * failing shows on the platform home. A route nothing schedules (it runs from another job or a person) is listed with why.
 */
const DIR = join(process.cwd(), "src/app/api/cron");
const NOT_SCHEDULED: Record<string, string> = {
  "document-pdfs": "run by the dispatcher's invoice job and by staff, not on a schedule of its own",
};

const routes = readdirSync(DIR).filter((name) => readdirSync(join(DIR, name)).includes("route.ts"));

/** The table's own rule for a job's key (`cron_jobs_job`): lower case, so a camel-case name would be refused at the first run. */
const JOB_KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

describe("cron routes", () => {
  it.each(routes)("%s names its jobs as the ledger takes them", (name) => {
    const source = readFileSync(join(DIR, name, "route.ts"), "utf8");
    for (const [, job] of source.matchAll(/tracked(?:Route)?\("([^"]+)"/g)) expect(job, `${name}: ${job}`).toMatch(JOB_KEY);
  });

  it.each(routes)("%s has a maxDuration and is tracked", (name) => {
    const source = readFileSync(join(DIR, name, "route.ts"), "utf8");
    expect(source, `${name} needs export const maxDuration`).toMatch(/export const maxDuration = \d+;/);
    if (NOT_SCHEDULED[name]) return;
    expect(source, `${name} should run inside trackedRoute() or tracked()`).toMatch(new RegExp(`tracked(Route)?\\("route\\.${name}"`));
  });
});
