import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Old rows are pruned once a day (or once an hour for the two logs kept 24 hours), not every five minutes and not every minute
 * (bloat review step 0.31, FT-3). A later step that adds or removes a dispatcher job changes the number in the first case in the same commit.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const DISPATCHER = "src/app/api/cron/cart-reminders/route.ts";
// The job list itself moved to its own module (bloat review step 1.10); the hourly prunes stay in the route.
const JOBS = "src/server/dispatcher-jobs.ts";
const DAILY = "src/app/api/cron/subscription-reminders/route.ts";
const DISPATCHER_JOBS = 91; // 91 with the social posting queue (D870 S3.2); 90 with reminders on tasks and lists (D903 P4.3); 89 with telling a task's person (D904 P8.3d); 88 with the repeating checklist tasks (D903 P4.1); 87 with the rivals' watcher (D900 M3); 86 with the Facebook Pages' figures (D870 S1.2b); 85 with the social media adviser's weekly review (D870 S1.5); 84 with the Instagram posts' figures (D870 S1.2); 83 with the incident log (D895); 82 with the owners' journey (D886); 78 when the step was written, 84 when it was carried out, minus the nine prunes; 78 with the domain watch (E4.2) and the autopilot's tests (E4.1); 79 with the contracts' upkeep (D795); 80 with the documents' PDFs asked for (D807); 81 with the products' standard category words (bloat review step 2.23).

const NINE = [
  "pruneSearchLog",
  "pruneSearchCache",
  "pruneFormSubmissions",
  "pruneChatUsage",
  "pruneRecommendEvents",
  "pruneDocsCounts",
  "pruneReplications",
  "pruneApiIdempotency",
  "pruneOAuthTokens",
];

describe("prunes run daily or hourly, not in the busy runs", () => {
  it(`the dispatcher holds ${DISPATCHER_JOBS} jobs and none of the nine prunes`, () => {
    const source = read(JOBS);
    const start = source.indexOf("export const DISPATCHER_JOBS = {");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    const block = source.slice(start, end);
    expect(block.split("\n").filter((line) => /^ {2}[A-Za-z0-9]+: /.test(line))).toHaveLength(DISPATCHER_JOBS);
    for (const name of NINE) expect(block, name).not.toContain(name);
  });

  it("the daily run tracks the seven prunes and the dispatcher the two hourly ones", () => {
    const daily = read(DAILY);
    for (const name of ["searches", "search-cache", "forms", "chat", "recommendations", "docs-counts", "replications"]) {
      expect(daily).toContain(`tracked("daily.${name}", 86400,`);
    }
    const dispatcher = read(DISPATCHER);
    expect(dispatcher).toContain('tracked("hourly.api-idempotency", 3600');
    expect(dispatcher).toContain('tracked("hourly.oauth-tokens", 3600');
  });

  it("the every-minute runners prune nothing", () => {
    const runners: [string, string, string][] = [
      ["src/server/integrations.ts", "deliverDue", "delete from commerce.integration_deliveries"],
      ["src/server/platform-integrations.ts", "deliverPlatformDue", "delete from commerce.platform_integration_deliveries"],
      ["src/server/workflows.ts", "runWorkflows", "delete from commerce.workflow_runs"],
      ["src/server/platform-workflows.ts", "runPlatformWorkflows", "delete from commerce.platform_workflow_runs"],
    ];
    for (const [file, fn, statement] of runners) {
      const source = read(file);
      const start = source.indexOf(`export async function ${fn}`);
      expect(start, `${file} has ${fn}`).toBeGreaterThan(-1);
      const next = source.indexOf("\nexport ", start + 1);
      expect(source.slice(start, next === -1 ? undefined : next), `${fn} deletes`).not.toContain(statement);
    }
  });

  it("the nine old names are retired", () => {
    const source = read("src/server/cron-runs.ts");
    for (const name of ["searches", "cache", "forms", "chat", "recommendations", "docs-counts", "replications", "api-idempotency", "oauth-tokens"]) {
      expect(source, name).toContain(`"dispatcher.${name}"`);
    }
  });
});
