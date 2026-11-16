import { describe, expect, it } from "vitest";
import { KNOWN_COOKIES } from "./known-cookies";

describe("the cookie table", () => {
  it("is the same list, in the same order, field by field", async () => {
    // Fields are written in sorted order, so the snapshot holds what each entry says, not where its table lists the field.
    const rows = KNOWN_COOKIES.map((c) => {
      const row: Record<string, unknown> = { ...c, pattern: `${c.pattern.source}/${c.pattern.flags}` };
      return Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]]));
    });
    await expect(JSON.stringify(rows, null, 1)).toMatchFileSnapshot("./known-cookies.snapshot.json");
  });
});
