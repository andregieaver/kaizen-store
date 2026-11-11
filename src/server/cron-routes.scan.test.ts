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

  it("names the once-a-day runs of the dispatcher's jobs as the ledger takes them, each claimed day run under the same name (D436)", () => {
    const server = join(process.cwd(), "src/server");
    const sources = readdirSync(server)
      .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
      .map((file) => ({ file, text: readFileSync(join(server, file), "utf8") }));
    const claimed = sources.flatMap(({ file, text }) => [...text.matchAll(/claimDay\("([^"]+)"/g)].map((m) => ({ file, job: m[1], text })));
    // The nightly interface translations (D436) are one: the dispatcher's `uiTranslations`, kept as `daily.ui-translations`.
    expect(claimed.map((c) => c.job)).toContain("daily.ui-translations");
    for (const { file, job, text } of claimed) {
      expect(job, `${file}: ${job}`).toMatch(JOB_KEY);
      expect(text, `${file} claims ${job}'s day, so it runs it as tracked("${job}", 86_400, …)`).toContain(`tracked("${job}", 86_400,`);
    }
    for (const { file, text } of sources) for (const [, job] of text.matchAll(/tracked\("([^"]+)"/g)) expect(job, `${file}: ${job}`).toMatch(JOB_KEY);
    const dispatcher = readFileSync(join(DIR, "cart-reminders", "route.ts"), "utf8");
    expect(dispatcher).toMatch(/uiTranslations: \(\) => runNightlyUiTranslations\(\)/);
  });

  it.each(routes)("%s has a maxDuration and is tracked", (name) => {
    const source = readFileSync(join(DIR, name, "route.ts"), "utf8");
    expect(source, `${name} needs export const maxDuration`).toMatch(/export const maxDuration = \d+;/);
    if (NOT_SCHEDULED[name]) return;
    expect(source, `${name} should run inside trackedRoute() or tracked()`).toMatch(new RegExp(`tracked(Route)?\\("route\\.${name}"`));
  });
});

/**
 * A payment provider's or another service's webhook has a time limit too (code review 1.5, FD9): one held up by a slow query would keep
 * one of the instance's five database connections until the platform killed the function. Every route under `api/stripe` and
 * `api/mollie`, and every route in a `webhook` or `webhooks` folder, says its own.
 */
describe("webhook routes", () => {
  const API = join(process.cwd(), "src/app/api");
  const routeFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? routeFiles(join(dir, entry.name)) : entry.name === "route.ts" ? [join(dir, entry.name)] : [],
    );
  const webhooks = routeFiles(API)
    .map((file) => file.slice(API.length + 1))
    .filter((path) => /^(stripe|mollie)\//.test(path) || /(^|\/)webhooks?\//.test(path))
    // A document about webhooks (`webhooks/v1/topics.json`, the topics a developer can choose) receives none.
    .filter((path) => !/\.json\/route\.ts$/.test(path));

  it("finds the payment providers' webhooks", () => {
    expect(webhooks).toEqual(expect.arrayContaining(["stripe/webhook/[storeId]/route.ts", "stripe/billing/[mode]/route.ts", "mollie/[mode]/route.ts"]));
  });

  it.each(webhooks)("%s has a time limit", (path) => {
    expect(readFileSync(join(API, path), "utf8")).toMatch(/^export const maxDuration = \d+;$/m);
  });
});

