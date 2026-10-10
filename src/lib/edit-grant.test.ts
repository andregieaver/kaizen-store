import { describe, expect, it } from "vitest";

import { readGrant, signGrant } from "./edit-grant";
import { EDIT_MINUTES, ENTER_SECONDS, backPath } from "./edit-link";

/**
 * The pass for changing a page's words on a store's own domain (D193) is two signed tokens that say who, for which store and what for.
 */

const secret = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 9);
const who = { storeId: "11111111-1111-4111-8111-111111111111", store: "min-butikk", account: "22222222-2222-4222-8222-222222222222" };
const NOW = 1_800_000_000_000;

describe("a signed token", () => {
  it("says who it is for, and is read back by the kind it was made as", () => {
    const enter = signGrant(secret, { kind: "enter", ...who }, NOW);
    expect(readGrant(secret, enter, "enter", NOW + 1000)).toEqual({ kind: "enter", ...who, expires: NOW + ENTER_SECONDS * 1000 });
    const edit = signGrant(secret, { kind: "edit", ...who }, NOW);
    expect(readGrant(secret, edit, "edit", NOW + 60_000)).toEqual({ kind: "edit", ...who, expires: NOW + EDIT_MINUTES * 60_000 });
  });

  it("is not the other kind: the link in an address cannot be used as the pass", () => {
    const enter = signGrant(secret, { kind: "enter", ...who }, NOW);
    const edit = signGrant(secret, { kind: "edit", ...who }, NOW);
    expect(readGrant(secret, enter, "edit", NOW)).toBeNull();
    expect(readGrant(secret, edit, "enter", NOW)).toBeNull();
  });

  it("ends: the link after ninety seconds, the pass after thirty minutes", () => {
    const enter = signGrant(secret, { kind: "enter", ...who }, NOW);
    expect(readGrant(secret, enter, "enter", NOW + ENTER_SECONDS * 1000 - 1)).not.toBeNull();
    expect(readGrant(secret, enter, "enter", NOW + ENTER_SECONDS * 1000)).toBeNull();
    const edit = signGrant(secret, { kind: "edit", ...who }, NOW);
    expect(readGrant(secret, edit, "edit", NOW + EDIT_MINUTES * 60_000 - 1)).not.toBeNull();
    expect(readGrant(secret, edit, "edit", NOW + EDIT_MINUTES * 60_000)).toBeNull();
  });

  it("is refused when it was not signed by this server's key", () => {
    const token = signGrant(secret, { kind: "edit", ...who }, NOW);
    expect(readGrant(other, token, "edit", NOW)).toBeNull();
  });

  it("is refused when anything in it was changed: the account, the store, the time or the signature", () => {
    const token = signGrant(secret, { kind: "edit", ...who }, NOW);
    const [body, sig] = token.split(".");
    const fields = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown[];
    const remake = (change: (copy: unknown[]) => void) => {
      const copy = [...fields];
      change(copy);
      return `${Buffer.from(JSON.stringify(copy)).toString("base64url")}.${sig}`;
    };
    expect(readGrant(secret, remake((f) => (f[4] = "33333333-3333-4333-8333-333333333333")), "edit", NOW)).toBeNull();
    expect(readGrant(secret, remake((f) => (f[3] = "annen-butikk")), "edit", NOW)).toBeNull();
    expect(readGrant(secret, remake((f) => (f[5] = (f[5] as number) + 3_600_000)), "edit", NOW)).toBeNull();
    expect(readGrant(secret, `${body}.${sig.slice(0, -2)}AA`, "edit", NOW)).toBeNull();
    expect(readGrant(secret, `${body}x.${sig}`, "edit", NOW)).toBeNull();
  });

  it("is refused when it claims to last longer than its kind does, even with a right signature", () => {
    // Only this server can sign, but a bug that signed a long one must not make a long pass.
    const body = Buffer.from(JSON.stringify([1, "edit", who.storeId, who.store, who.account, NOW + 24 * 3_600_000])).toString("base64url");
    const fine = signGrant(secret, { kind: "edit", ...who }, NOW);
    const sig = fine.split(".")[1];
    expect(readGrant(secret, `${body}.${sig}`, "edit", NOW)).toBeNull();
  });

  it("is refused for anything that is not a token", () => {
    for (const bad of [undefined, null, "", ".", "a.b.c", "x", "x".repeat(700), `${"x".repeat(50)}.${"y".repeat(43)}`]) {
      expect(readGrant(secret, bad as string | null | undefined, "edit", NOW)).toBeNull();
    }
  });
});

describe("where a person is taken back to", () => {
  it("is a path of the store's own host, as the browser had it, without a fragment", () => {
    expect(backPath("/")).toBe("/");
    expect(backPath("/no/om-oss?x=1#top")).toBe("/no/om-oss?x=1");
    expect(backPath("/blog/hello%20world")).toBe("/blog/hello%20world");
  });

  it("is never another address, nor the API", () => {
    for (const bad of [
      "",
      null,
      undefined,
      "no-slash",
      "//evil.example/",
      "/\\evil.example",
      "https://evil.example/",
      "/path\nwith-newline",
      "javascript:alert(1)",
      "/api/platform/editor/text",
      "/_next/static/x.js",
      `/${"a".repeat(1600)}`,
    ]) {
      expect(backPath(bad as string | null | undefined)).toBeNull();
    }
  });
});
