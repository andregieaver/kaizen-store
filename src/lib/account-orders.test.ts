import { describe, expect, it } from "vitest";

import { accountOrdersQuery, cursorOf, parseAccountOrderParams, readCursor } from "./account-orders";

const id = "0b0e6c8e-1f2a-4c3d-8e9f-0a1b2c3d4e5f";

describe("finding an order in My account (D304 J2)", () => {
  it("reads the search, state and cursor, dropping what is not valid", () => {
    const after = cursorOf({ placedAt: "2026-10-01T10:00:00.000Z", id });
    const q = parseAccountOrderParams({ q: "  #1001  sko ", state: "sent", after, other: "x" });
    expect(q.search.words.map((w) => w.raw)).toEqual(["#1001", "sko"]);
    expect(q.state).toBe("sent");
    expect(q.after).toEqual({ placedAt: "2026-10-01T10:00:00.000Z", id });
    expect(parseAccountOrderParams({ state: "lost", after: "bad!" })).toMatchObject({ state: null, after: null });
  });

  it("refuses a cursor that is not a time and an id", () => {
    expect(readCursor(Buffer.from("yesterday|x").toString("base64url"))).toBeNull();
    expect(readCursor(Buffer.from(`2026-10-01|${id}|more`).toString("base64url"))).toBeNull();
  });

  it("writes a page's address with what is set only", () => {
    expect(accountOrdersQuery({ text: "", state: null })).toBe("");
    expect(accountOrdersQuery({ text: "sko", state: "open" })).toBe("?q=sko&state=open");
  });
});
