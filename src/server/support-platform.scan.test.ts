import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The platform never reads a store's conversations (D216, 2.8 and 6.2): its support modules, pages and tools read counts only. These
 * words name what a store's conversations hold beyond their counts; none may appear in what the platform's per-store view runs.
 */
const FORBIDDEN = [
  "support_messages",
  "support_actions",
  "contact_name",
  "contact_email",
  "customer_id",
  "rating_comment",
  "page_path",
  "brief",
  "staffConversation",
  "staffList",
  "conversationFeed",
  "transcriptOf",
];

const root = join(__dirname, "..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });

const PLATFORM = [join(root, "server/support-platform.ts"), join(root, "components/admin/support/store-totals-view.tsx"), ...files(join(root, "app/admin/(gated)/platform/support/stores"))];

describe("the platform's view of stores' support reads counts only", () => {
  it.each(PLATFORM.map((f) => [f.slice(root.length + 1), f]))("%s", (_, file) => {
    const source = readFileSync(file, "utf8");
    for (const word of FORBIDDEN) expect(source, `${file} names ${word}`).not.toContain(word);
  });

  it("reads a summary only without its title, text and follow-up", () => {
    const reports = readFileSync(join(root, "server/support-reports.ts"), "utf8");
    expect(reports).toContain("c.summary - 'text' - 'followUp' - 'title' as summary");
    const platform = readFileSync(join(root, "server/support-platform.ts"), "utf8");
    // Every row it reads comes through the counted columns.
    expect(platform.match(/select /g)?.length).toBe(platform.match(/select \$\{ROW_COLUMNS\}|select s\.id, s\.slug|select count\(\*\)::int|select 1 from/g)?.length);
  });
});
