import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));

const { addPlatformAdmin, listPlatformAdmins, removePlatformAdmin, setPlatformRole } = await import("./platform-team");

/**
 * The platform's team (D471), against the database: adding a platform admin by email (an account found, or a new one), who becomes an owner
 * of Kaizena Flow's own store; never twice, never a disabled account; removing one, never oneself and never the last. Roles (D510): someone
 * added or moved to another role works in Kaizena Flow's store as an admin in the store role of the same work, never its owner; only an
 * owner changes the team, never their own place, and the platform keeps an owner.
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

const houseRole = async (id: string) =>
  (
    await db().execute<{ role: string; template: string | null; permissions: string[] }>(sql`
      select m.role::text as role, r.template, r.permissions from commerce.store_members m join commerce.stores s on s.id = m.store_id and s.house
      left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
      where m.account_id = ${id}::uuid and m.disabled_at is null
    `)
  )[0] ?? null;

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

  it("gives roles: a member is an admin of Kaizena Flow's store in their work's store role, and an owner stays", async () => {
    const me = await admin(`team-me3-${run}@example.com`);
    expect(await addPlatformAdmin(me, `team-writer-${run}@example.com`, "Wenche", "content")).toEqual({ ok: true, email: `team-writer-${run}@example.com` });
    const [writer] = await db().execute<{ id: string; platform_admin: boolean; platform_role: string }>(
      sql`select id, platform_admin, platform_role from commerce.accounts where email = ${`team-writer-${run}@example.com`}`,
    );
    expect([writer.platform_admin, writer.platform_role]).toEqual([false, "content"]);
    expect(await houseOwner(writer.id)).toBe(false);
    expect(await houseRole(writer.id)).toEqual({ role: "admin", template: "content", permissions: expect.arrayContaining(["website:write"]) });
    expect((await listPlatformAdmins(me)).find((p) => p.id === writer.id)?.role).toBe("content");

    // Moved to read-only, then made an owner: the store role follows; never one's own place.
    expect((await setPlatformRole(me, writer.id, "read_only")).ok).toBe(true);
    expect((await houseRole(writer.id))?.template).toBe("read_only");
    expect((await setPlatformRole(me, writer.id, "owner")).ok).toBe(true);
    expect(await houseOwner(writer.id)).toBe(true);
    expect(await setPlatformRole(me, me.id, "finance")).toEqual({ ok: false, problem: "self" });

    // Only an owner changes the team.
    const reader = { id: writer.id, email: "x", name: null, platformAdmin: false, platformRole: "read_only" } as Account;
    expect(await setPlatformRole(reader, me.id, "read_only")).toEqual({ ok: false, problem: "invalid" });
    expect(await addPlatformAdmin(reader, `team-sneak-${run}@example.com`, "")).toEqual({ ok: false, problem: "invalid" });

    // Taken off the team: out of the store.
    expect((await removePlatformAdmin(me, writer.id)).ok).toBe(true);
    expect(await houseOwner(writer.id)).toBe(false);
    expect(await houseRole(writer.id)).toBeNull();
  });
});

