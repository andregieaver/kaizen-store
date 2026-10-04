import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A collaborator whose time has run out is not a member of the store (wave 1, 1f review), whether or not the daily job has marked it
 * yet: `getMembership()` already says so, and every other read of `commerce.store_members` that decides who may SEE or ACT in a store
 * has to say it too. A statement that reads the table passes when it checks `expires_at`, or asks for owners only (a collaborator is never
 * one), or is on the list below with the reason it is meant to see ended collaborators as well.
 */
const ALLOWED: Record<string, string> = {
  "activity.ts": "the log's own people list: history shows everyone who ever acted, with whether they are still current",
  "audit.ts": "writes a person's own security event into each store they work in, so an owner sees what happened to their staff",
  "security-jobs.ts": "the daily job that ends expired collaborators",
  "settings.ts": "the staff list and inviting: an owner sees ended collaborators and can extend them",
  "store-roles.ts": "roles, invitations and extensions of collaborators: ended ones are managed here",
  "trust-fixtures.ts": "test fixtures",
  "work-test-support.ts": "test fixtures",
  "two-step.ts": "who a store's requirement for two-step sign-in is counted over (every member, ended or not)",
  "platform-customers.ts": "the platform admin's own list of accounts and their stores",
  "platform.ts": "a platform count of members",
  "store-copy.ts": "counts the stores an account owns",
};

const dir = join(process.cwd(), "src/server");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !/\.(test|int\.test)\.ts$/.test(f));

describe("readers of store_members", () => {
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    if (!text.includes("commerce.store_members")) continue;
    it(`${file} leaves out a collaborator whose access has ended, or says why not`, () => {
      const problems: string[] = [];
      let from = 0;
      for (;;) {
        const at = text.indexOf("commerce.store_members", from);
        if (at < 0) break;
        from = at + 1;
        // The statement around the read: its `from` and its `where` (a window, since a statement can hold nested templates).
        const statement = text.slice(Math.max(0, at - 300), at + 700);
        const ok = /expires_at/.test(statement) || /role\s*=\s*'owner'/.test(statement) || file in ALLOWED;
        if (!ok) problems.push(text.slice(text.lastIndexOf("\n", at), text.indexOf("\n", at)).trim());
      }
      expect(problems).toEqual([]);
    });
  }

  it("keeps the allow list to files that read the table", () => {
    for (const file of Object.keys(ALLOWED)) {
      const path = join(dir, file);
      let text = "";
      try {
        text = readFileSync(path, "utf8");
      } catch {
        // a fixture or file that moved
      }
      expect([file, text.includes("commerce.store_members")]).toEqual([file, true]);
    }
  });
});
