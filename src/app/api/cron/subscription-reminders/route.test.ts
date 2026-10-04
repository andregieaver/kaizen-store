import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The daily cron runs the privacy jobs (D162, G11): the retention schedule, the erasures that began and did not finish, and the reminders about
 * requests that are due. A source scan, since the route is exercised by its jobs' own integration tests (`retention.int.test.ts`,
 * `privacy-erasure.int.test.ts`, `privacy-requests.int.test.ts`).
 */
describe("the daily cron", () => {
  const text = readFileSync(join(process.cwd(), "src/app/api/cron/subscription-reminders/route.ts"), "utf8");

  it("calls the retention schedule, the erasure resume and the privacy reminders, each of which never throws", () => {
    expect(text).toMatch(/import \{ runRetention \} from "@\/server\/retention"/);
    expect(text).toMatch(/import \{ resumeErasures \} from "@\/server\/privacy-erasure"/);
    expect(text).toMatch(/sendDueReminders as sendPrivacyReminders/);
    expect(text).toMatch(/runRetention\(\)/);
    expect(text).toMatch(/resumeErasures\(\)/);
    expect(text).toMatch(/sendPrivacyReminders\(\)/);
  });

  it("reports what the schedule did and keeps the secret check first", () => {
    expect(text).toMatch(/retention: \{ counts: retention\.counts/);
    expect(text.indexOf("cronAuthorised")).toBeLessThan(text.indexOf("runRetention()"));
  });
});
