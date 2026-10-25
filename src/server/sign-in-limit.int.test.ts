import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const limit = await import("./sign-in-limit");

/**
 * The admin's limit on password sign-in per email (PSI SEC-02): ten wrong tries in a window stop it for that address, the count is kept
 * under a hash and never the address, any address is counted alike, and a sign-in that worked starts the count again.
 */

const email = `limit-${Date.now().toString(36)}@example.com`;

afterAll(async () => {
  await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket = ${limit.signInBucket(email)}`);
  await closeDb();
});

describe("the admin's sign-in limit", () => {
  it("stops password sign-in for an address after its wrong tries, and only for that address", async () => {
    expect(await limit.signInLocked(email)).toBe(false);
    for (let i = 0; i < limit.SIGN_IN_TRIES - 1; i++) await limit.countFailedSignIn(email);
    expect(await limit.signInLocked(email)).toBe(false);
    await limit.countFailedSignIn(email.toUpperCase());
    expect(await limit.signInLocked(` ${email} `)).toBe(true);
    expect(await limit.signInLocked(`other-${email}`)).toBe(false);

    const rows = await db().execute<{ bucket: string }>(sql`select bucket from commerce.chat_usage where store_id is null and bucket like 'signin:%'`);
    expect(rows.every((r) => !r.bucket.includes("@"))).toBe(true);

    await limit.clearSignIns(email);
    expect(await limit.signInLocked(email)).toBe(false);
  });

  it("keys an address by a hash made with the settings key when there is one", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(limit.signInBucket("Kari@Example.com", key)).toBe(limit.signInBucket(" kari@example.com", key));
    expect(limit.signInBucket("kari@example.com", key)).not.toBe(limit.signInBucket("kari@example.com", undefined));
    expect(limit.signInBucket("kari@example.com", key)).toMatch(/^signin:[0-9a-f]{32}$/);
  });
});
