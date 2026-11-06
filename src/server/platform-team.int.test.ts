import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));

const { addPlatformAdmin, listPlatformAdmins, removePlatformAdmin } = await import("./platform-team");

/**
 * The platform's team (D471), against the database: adding a platform admin by email (an account found, or a new one), who becomes an owner
 * of Kaizena Flow's own store; never twice, never a disabled account; removing one, never oneself and never the last.
 */

const run = Date.now().toString(36);

async function admin(email: string): Promise<Account> {
  const [row] = await db().execute<{ id: string }>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Pia', true) returning id`);
  return { id: row.id, email, name: "Pia", platformAdmin: true } as Account;
}

const houseOwner = async (id: string) =>
  (await db().execute<{ n: number }>(sql`
    select count(*)::int as n from commerce.store_members m join commerce.stores s on s.id = m.store_id and s.house
    where m.account_id = ${id}::uuid and m.role = 'owner' and m.disabled_at is null
  `))[0].n === 1;

describe("the platform's team (D471)", () => {
  it("adds a new person and an existing account, each an owner of Kaizena Flow's store, and never twice", async () => {
    const me = await admin(`team-me-${run}@example.com`);
    expect(await addPlatformAdmin(me, `  Team-New-${run}@Example.com `, "Nina New")).toEqual({ ok: true, email: `team-new-${run}@example.com` });
    const [made] = await db().execute<{ id: string; name: string }>(sql`select id, name from commerce.accounts where email = ${`team-new-${run}@example.com`}`);
    expect(made.name).toBe("Nina New");
    expect(await houseOwner(made.id)).toBe(true);
    const [existing] = await db().execute<{ id: string }>(sql`insert into commerce.accounts (email) values (${`team-old-${run}@example.com`}) returning id`);
    expect((await addPlatformAdmin(me, `team-old-${run}@example.com`, "")).ok).toBe(true);
    expect(await houseOwner(existing.id)).toBe(true);
    expect(await addPlatformAdmin(me, `team-old-${run}@example.com`, "")).toEqual({ ok: false, problem: "already" });
    expect(await addPlatformAdmin(me, "not an email", "")).toEqual({ ok: false, problem: "invalid" });
    await db().execute(sql`insert into commerce.accounts (email, disabled_at) values (${`team-off-${run}@example.com`}, now())`);
    expect(await addPlatformAdmin(me, `team-off-${run}@example.com`, "")).toEqual({ ok: false, problem: "disabled" });
    expect((await listPlatformAdmins(me)).find((p) => p.id === me.id)?.you).toBe(true);
  });

  it("removes another, never oneself, and their place in the store goes with it", async () => {
    const me = await admin(`team-me2-${run}@example.com`);
    const other = await admin(`team-other-${run}@example.com`);
    expect(await removePlatformAdmin(me, me.id)).toEqual({ ok: false, problem: "self" });
    expect(await removePlatformAdmin(me, other.id)).toEqual({ ok: true, email: `team-other-${run}@example.com` });
    expect(await houseOwner(other.id)).toBe(false);
    expect(await removePlatformAdmin(me, other.id)).toEqual({ ok: false, problem: "not_found" });
  });
});
