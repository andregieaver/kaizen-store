import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A shopper session is *fresh* (`customer_sessions.verified_at`, D162) only when the browser proved who it is just now, with a code or a password:
 * downloading or deleting one's own data needs that, so a session that was handed out without a proof must start stale. Every caller of
 * `startSession()` outside `customers.ts` is listed here with what it passes, so a new way to sign in has to decide.
 */

const ROOT = join(process.cwd(), "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Caller file (relative to `src/`) -> the number of `startSession()` calls that prove who it is (fresh) and that do not (`verified: false`). */
const CALLERS: Record<string, { fresh: number; stale: number; why: string }> = {
  "app/s/[store]/[market]/account/actions.ts": {
    fresh: 4,
    stale: 1,
    why: "The code, the password, registering with a password and the reset code each prove it; the one-time link on the order page after checkout (checkoutSignInAction) is a convenience and starts stale.",
  },
  "app/s/[store]/[market]/account/sign-in/[token]/actions.ts": { fresh: 1, stale: 0, why: "A one-time link emailed to the address on file, spent by a button press: the inbox proved it." },
};

describe("every way to start a shopper session decides whether it is fresh", () => {
  it("lists each caller of startSession() with what it passes", () => {
    const found: Record<string, { fresh: number; stale: number }> = {};
    for (const file of sources(ROOT)) {
      const relative = file.slice(ROOT.length + 1);
      if (relative === join("server", "customers.ts")) continue;
      const source = readFileSync(file, "utf8");
      const calls = [...source.matchAll(/\bstartSession\(([^;]*)\)/g)].map((m) => m[1]);
      if (calls.length === 0) continue;
      found[relative] = {
        stale: calls.filter((args) => /verified:\s*false/.test(args)).length,
        fresh: calls.filter((args) => !/verified:\s*false/.test(args)).length,
      };
    }
    const expected = Object.fromEntries(Object.entries(CALLERS).map(([file, { fresh, stale }]) => [file, { fresh, stale }]));
    expect(found).toEqual(expected);
  });

  it("gives every listed caller a reason", () => {
    for (const [file, entry] of Object.entries(CALLERS)) expect(entry.why.length, file).toBeGreaterThan(20);
  });

  it("starts a session fresh unless told otherwise, and stale one day back when told not to", () => {
    const source = readFileSync(join(ROOT, "server", "customers.ts"), "utf8");
    expect(source).toMatch(/startSession\(storeId: string, customerId: string, \{ verified = true \}/);
    expect(source).toMatch(/verified \? sql`now\(\)` : sql`now\(\) - interval '1 day'`/);
  });
});
