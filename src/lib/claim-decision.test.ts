import { describe, expect, it } from "vitest";

import { indexRow } from "../../scripts/decisions.mjs";
import { claimIsFree, claimWith, fileStub, nextDecision, stubRow, withStub } from "../../scripts/lib/claim-decision.mjs";

const TABLE = [
  "# Decisions",
  "",
  "<!-- decisions:index -->",
  "| # | Decision | Date | Text |",
  "|---|---|---|---|",
  indexRow(1, "First", "2026-01-01"),
  indexRow(540, "Later", "2026-02-01"),
  indexRow(550, "Last", "2026-03-01"),
  "<!-- /decisions:index -->",
  "",
  "### After",
  "",
  "text",
].join("\n");
const ROWS = "docs/decisions.md";

describe("claiming a decision's number (bloat review step 0.41)", () => {
  it("takes the highest number plus one and never reuses a gap", () => {
    expect(nextDecision(TABLE)).toBe(551);
    expect(() => nextDecision("no rows")).toThrow("No decision rows found");
  });

  it("puts the stub row directly before the index's closing marker and leaves every other line as it was", () => {
    const out = withStub(TABLE, 551, "A title", "2026-11-16");
    const before = TABLE.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length + 1);
    expect(after[8]).toBe(indexRow(551, "A title", "2026-11-16"));
    expect(after[8]).toBe("| D551 | **A title** | 2026-11-16 | [text](decisions/D551.md) |");
    expect(after[9]).toBe("<!-- /decisions:index -->");
    expect([...after.slice(0, 8), ...after.slice(9)]).toEqual(before);
  });

  it("refuses a table without the index markers", () => {
    expect(() => withStub("| D1 | **A** | 2026-01-01 | [text](decisions/D1.md) |", 2, "B", "2026-11-16")).toThrow("No index markers found");
  });

  it("makes the decision's own file: line 1 and the date", () => {
    expect(fileStub(551, "A title", "2026-11-16")).toBe("# D551: A title\n\nDate: 2026-11-16\n");
  });

  it("refuses a number that is taken", () => {
    expect(() => withStub(withStub(TABLE, 551, "A", "2026-11-16"), 551, "B", "2026-11-16")).toThrow("D551 is taken");
  });

  it("reads again and takes the next number when a push is refused", async () => {
    const pushed: string[] = [];
    const other = withStub(TABLE, 551, "Another session", "2026-11-16");
    let reads = 0;
    const id = await claimWith(
      {
        read: async () => (reads++ === 0 ? TABLE : other),
        push: async (files: Record<string, string>) => {
          expect(Object.keys(files).sort()).toEqual([ROWS, `docs/decisions/D${pushed.length === 0 ? 551 : 552}.md`].sort());
          pushed.push(files[ROWS]);
          return pushed.length > 1;
        },
      },
      "Mine",
      "2026-11-16",
    );
    expect(id).toBe(552);
    expect(pushed).toHaveLength(2);
    expect(pushed[1]).toContain("| D551 |");
    expect(pushed[1]).toContain("| D552 |");
    expect(pushed[1].indexOf("| D552 |")).toBeLessThan(pushed[1].indexOf("<!-- /decisions:index -->"));
  });

  it("gives up after five refused pushes", async () => {
    let pushes = 0;
    await expect(
      claimWith(
        {
          read: async () => TABLE,
          push: async () => {
            pushes += 1;
            return false;
          },
        },
        "Mine",
        "2026-11-16",
      ),
    ).rejects.toThrow("main kept moving: no number claimed");
    expect(pushes).toBe(5);
  });

  it("removes a bar and a line break from a title and cuts it to 120 characters", () => {
    expect(stubRow(7, "a|b\nc", "2026-11-16")).toBe("| D7 | **abc** | 2026-11-16 | [text](decisions/D7.md) |");
    expect(stubRow(7, "x".repeat(300), "2026-11-16")).toContain(`**${"x".repeat(120)}**`);
  });

  it("claims only while a docs push runs no CI and no deploy", () => {
    const ci = '    paths-ignore:\n      - "**/*.md"\n      - "!docs/**"\n';
    const vercel = JSON.stringify({ git: { deploymentEnabled: { main: false } } });
    expect(claimIsFree(ci, vercel)).toBe(true);
    expect(claimIsFree("paths: []", vercel)).toBe(false);
    expect(claimIsFree(ci, JSON.stringify({ git: { deploymentEnabled: { main: true } } }))).toBe(false);
    expect(claimIsFree(ci, "not json")).toBe(false);
  });
});
