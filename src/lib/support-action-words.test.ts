import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACTION_KIND_WORDS, CUSTOMER_ACTION_KINDS } from "./support-action-words";
import { CUSTOMER_ACTION_KINDS as KINDS } from "./support-actions";

describe("customer action kinds (D216, 4.4)", () => {
  it("are listed for the browser exactly as the schemas have them, each with a name", () => {
    expect([...CUSTOMER_ACTION_KINDS].sort()).toEqual([...KINDS].sort());
    expect(Object.keys(ACTION_KIND_WORDS).sort()).toEqual([...KINDS].sort());
  });

  it("each has a check and a runner in the server, and a case in the tests", () => {
    const server = readFileSync("src/server/support-actions.ts", "utf8");
    const tests = readFileSync("src/server/support-actions.int.test.ts", "utf8");
    for (const kind of KINDS) {
      expect(server.match(new RegExp(`case "${kind.replace(".", "\\.")}"`, "g"))?.length ?? 0, kind).toBeGreaterThanOrEqual(2);
      expect(tests, kind).toContain(`"${kind}"`);
    }
  });
});
