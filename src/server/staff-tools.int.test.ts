import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { addMember, makeAccount, makeStore } = await import("./trust-fixtures");
const { getStore } = await import("./stores");
const ownerTools = await import("./owner-tools");
const { OWNER_TOOLS } = await import("@/lib/owner-tools");

type Row = Record<string, unknown>;

/**
 * The AI manager's team and plan tools (PSI AGT-01): the team listed for the owner, an invitation, a role change and a removal through the
 * Staff page's own functions, each kept for a yes (`access`) and checked first; nobody but an owner changes the team, even with a yes; the
 * plan tools refuse a store without a plan (the first is paid by card on the Billing page).
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const ctx = async () => ({ account: store.account, store: (await getStore(store.slug))!, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);
const member = async (email: string) =>
  (await db().execute<Row>(sql`
    select m.role, m.kind, m.disabled_at, r.name as role_name from commerce.store_members m join commerce.accounts a on a.id = m.account_id
    left join commerce.store_roles r on r.id = m.role_id where m.store_id = ${store.id}::uuid and lower(a.email) = lower(${email})
  `))[0];

beforeAll(async () => {
  store = await makeStore("staff-tools");
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.id}::uuid`);
});

afterAll(async () => closeDb());

describe("the team tools", () => {
  it("are kept for a yes, as changes of access", () => {
    for (const name of ["invite_staff", "change_staff_role", "remove_staff"]) expect(OWNER_TOOLS.find((t) => t.name === name)).toMatchObject({ gate: "access" });
    for (const name of ["change_plan", "end_plan"]) expect(OWNER_TOOLS.find((t) => t.name === name)).toMatchObject({ gate: "spend" });
  });

  it("invites, changes a role and removes through the Staff page's functions", async () => {
    const c = await ctx();
    const email = `ny-${store.slug}@example.com`;
    await expect(ownerTools.preflightOwnerTool(c, "invite_staff", { email, role: "Nobody" })).rejects.toThrow(/no role "Nobody"/);
    await expect(ownerTools.preflightOwnerTool(c, "invite_staff", { email, role: "owner", collaborator_days: 30 })).rejects.toThrow(/collaborator cannot be an owner/);
    await ownerTools.preflightOwnerTool(c, "invite_staff", { email, role: "admin" });
    expect(await run("invite_staff", { email, role: "admin" })).toMatchObject({ done: expect.stringContaining("as admin") });
    expect(await member(email)).toMatchObject({ role: "admin", kind: "staff", disabled_at: null });
    await expect(ownerTools.preflightOwnerTool(c, "invite_staff", { email, role: "admin" })).rejects.toThrow(/already works in the store/);

    const listed = (await run("list_staff", {})) as { team: { email: string; role: string }[]; roles: { name: string }[] };
    expect(listed.team.map((p) => p.email)).toEqual(expect.arrayContaining([store.account.email, email]));
    const custom = listed.roles.find((r) => !["owner", "admin"].includes(r.name))!;
    expect(await run("change_staff_role", { person: email, role: custom.name.toUpperCase() })).toMatchObject({ done: expect.stringContaining(`is now ${custom.name}`) });
    expect(await member(email)).toMatchObject({ role: "admin", role_name: custom.name });

    await expect(ownerTools.preflightOwnerTool(c, "remove_staff", { person: store.account.email })).rejects.toThrow(/your own access/);
    expect(await run("remove_staff", { person: email })).toMatchObject({ done: expect.stringContaining("no longer has access") });
    expect((await member(email))?.disabled_at).not.toBeNull();
    await expect(ownerTools.preflightOwnerTool(c, "change_staff_role", { person: email, role: "admin" })).rejects.toThrow(/does not work in this store/);
  });

  it("refuses anyone but an owner, even when the call was approved", async () => {
    const admin = await makeAccount("Admin");
    await addMember(store.id, admin.id, "admin");
    const c = { account: admin, store: (await getStore(store.slug))!, invalidate: () => {} };
    // The admin's holder lacks the owner key: the tool is refused before it runs; with the owner's holder it still asks the membership again.
    await expect(ownerTools.runOwnerTool({ ...c, holder: { role: "admin" } }, "invite_staff", { email: "x@example.com", role: "admin" })).rejects.toThrow(ownerTools.OwnerToolError);
    await expect(ownerTools.runOwnerTool(c, "invite_staff", { email: "x@example.com", role: "admin" })).rejects.toThrow(/Only an owner/);
  });

  it("reads the plan, and refuses a change or an end without one", async () => {
    expect(await run("billing_overview", {})).toMatchObject({ plan: null, note: expect.stringContaining("no plan yet") });
    const c = await ctx();
    await expect(ownerTools.preflightOwnerTool(c, "change_plan", { plan: "Anything", interval: "month" })).rejects.toThrow(/no plan yet/);
    await expect(ownerTools.preflightOwnerTool(c, "end_plan", { when: "period_end" })).rejects.toThrow(/no plan to end/);
  });
});
