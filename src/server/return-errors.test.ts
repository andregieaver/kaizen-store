import { describe, expect, it } from "vitest";

import { guarded, refusal, returnErrorCode, returnErrorMessage, RETURN_ERROR_MESSAGES } from "./return-errors";

/** What the database's returns rules raise, as the Drizzle driver wraps it, and how it is worded. */

const wrapped = (message: string) => Object.assign(new Error("Failed query: update commerce.returns …"), { cause: Object.assign(new Error(message), { code: "23514" }) });

describe("return errors", () => {
  it("finds the code of a rule in the wrapped driver error and words it", () => {
    expect(returnErrorCode(wrapped("return_quantity: only 1 of 2 is left to return"))).toBe("return_quantity");
    expect(returnErrorMessage(wrapped("withdrawal_lapsed: the request was not confirmed within its time"))).toBe(RETURN_ERROR_MESSAGES.withdrawal_lapsed);
    expect(returnErrorCode(wrapped("copied_order: an order copied from another store is history"))).toBe("copied_order");
  });

  it("leaves what it does not know alone", () => {
    expect(returnErrorCode(new Error("connection refused"))).toBeNull();
    expect(returnErrorCode(wrapped("return_something_new: surprise"))).toBeNull();
    expect(returnErrorCode(null)).toBeNull();
  });

  it("turns a refusal into a plain result and lets a bug propagate", async () => {
    expect(
      await guarded(async () => {
        throw wrapped("return_ended: a return that has ended cannot be changed");
      }),
    ).toEqual({ ok: false, code: "return_ended", problem: RETURN_ERROR_MESSAGES.return_ended });
    await expect(
      guarded(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await guarded(async () => ({ ok: true as const }))).toEqual({ ok: true });
    expect(refusal("x", "y")).toEqual({ ok: false, code: "x", problem: "y" });
  });

  it("words every code the migration raises", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const file = readdirSync("supabase/migrations").find((name) => name.endsWith("_returns_rules.sql"))!;
    const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
    const codes = [...sql.matchAll(/RAISE EXCEPTION '((?:return|withdrawal)_[a-z_]+):/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(20);
    for (const code of new Set(codes)) expect(RETURN_ERROR_MESSAGES, code).toHaveProperty(code);
  });
});
