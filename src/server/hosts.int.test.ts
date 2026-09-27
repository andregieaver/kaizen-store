import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { defaultHours } from "@/lib/opening-hours";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const hosts = await import("./hosts");
const bookings = await import("./bookings");
const { signInAccount } = await import("./auth");

const run = Date.now().toString(36);
const slug = `hosts-${run}`;
let storeId: string;
let member: Membership;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(account.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug } as Store,
  };
});

afterAll(async () => {
  await closeDb();
});

const email = `kari-${run}@example.com`;
let hostId: string;

describe("hosts (D71)", () => {
  it("adds a host with their commission, who may then sign in to their own area", async () => {
    expect(await signInAccount(email)).toBeNull();
    expect(await hosts.inviteHost(member, { name: "", email: "nope", commissionPercent: "150", vatRegistered: false })).toEqual({
      ok: false,
      problems: ["Give the host a name.", "The commission is at most 100 %.", "Write the host's email address."],
    });
    const added = await hosts.inviteHost(member, { name: "Karis hytter", email, commissionPercent: "12.5", vatRegistered: false });
    if (!added.ok) throw new Error(added.problems.join(" "));
    hostId = added.id;
    expect(await hosts.inviteHost(member, { name: "Again", email: email.toUpperCase(), commissionPercent: "10", vatRegistered: false })).toEqual({
      ok: false,
      problems: [`${email.toUpperCase()} is already a host here.`],
    });
    expect(await hosts.listHosts(storeId)).toEqual([
      expect.objectContaining({ id: hostId, name: "Karis hytter", email, commissionBps: 1250, vatRegistered: false, disabled: false, listings: 0 }),
    ]);
    expect(await signInAccount(email)).toEqual({ linked: false });

    // Taken away, they can no longer sign in; given back, they can.
    expect(await hosts.setHostDisabled(member, hostId, true)).toBe(true);
    expect(await signInAccount(email)).toBeNull();
    expect(await hosts.setHostDisabled(member, hostId, false)).toBe(true);
    expect(await hosts.updateHost(member, hostId, { name: "Karis hytter AS", commissionPercent: "15", vatRegistered: true })).toEqual({
      ok: true,
      id: hostId,
    });
    expect(await hosts.hostChoices(storeId)).toEqual([{ id: hostId, name: "Karis hytter AS" }]);
  });

  it("gives a host rooms and listings of their own, and shows them only their own bookings", async () => {
    const room = await bookings.saveResource(member, null, { name: "Kari-hytta", email: "", capacity: "1", active: true, hostId }, "unit");
    const ours = await bookings.saveResource(member, null, { name: "Butikkens rom", email: "", capacity: "1", active: true }, "unit");
    if (!room.ok || !ours.ok) throw new Error("not saved");
    expect(await hosts.hostResources(storeId, hostId)).toEqual([{ id: room.id, name: "Kari-hytta", kind: "unit" }]);
    expect(await hosts.hostOwnsResource(storeId, hostId, room.id)).toBe(true);
    expect(await hosts.hostOwnsResource(storeId, hostId, ours.id)).toBe(false);
    // Staff are never a host's.
    const staff = await bookings.saveResource(member, null, {
      name: "Ola",
      email: "",
      capacity: "1",
      active: true,
      hostId,
      hours: JSON.stringify(defaultHours()),
    });
    if (!staff.ok) throw new Error(staff.problems.join(" "));
    expect((await bookings.getResource(storeId, staff.id))?.hostId).toBeNull();

    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-hytte'`);
    await db().execute(sql`update commerce.products set host_id = ${hostId}::uuid where id = ${String(product.id)}::uuid`);
    expect(await hosts.hostListings(storeId, hostId)).toEqual([expect.objectContaining({ handle: "demo-hytte", kind: "stay" })]);

    const hold = (resource: string) =>
      db().execute(sql`
        select commerce.hold_booking(${storeId}::uuid, ${String(product.id)}::uuid, null, ${resource}::uuid,
          now() + interval '3 days', now() + interval '4 days', now() + interval '3 days', now() + interval '4 days',
          now() + interval '15 minutes', null)
      `);
    await hold(room.id);
    await hold(ours.id);
    const from = new Date();
    const to = new Date(Date.now() + 10 * 86_400_000);
    // The host's listing, in either room: the host sees it; the store sees both.
    expect((await bookings.listBookings(storeId, from, to, ["unit"], hostId)).map((b) => b.staff).sort()).toEqual([
      "Butikkens rom",
      "Kari-hytta",
    ]);
    const [other] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-sykkelutleie'`);
    await db().execute(sql`
      select commerce.hold_booking(${storeId}::uuid, ${String(other.id)}::uuid, null, ${ours.id}::uuid,
        now() + interval '5 days', now() + interval '6 days', now() + interval '5 days', now() + interval '6 days',
        now() + interval '15 minutes', null)
    `);
    expect(await bookings.listBookings(storeId, from, to, ["unit"], hostId)).toHaveLength(2);
    expect(await bookings.listBookings(storeId, from, to, ["unit"])).toHaveLength(3);
  });
});
