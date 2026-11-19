import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * An extension's own trial (D748 step E5): 14 days, once per account per extension, its grace period set with it; only the account's owner,
 * never before extensions are sold, never for Kaizena Flow's own account; and the Extensions page's read of it.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const extensions = await import("./extensions");

const run = Date.now().toString(36);
let owner: Account;
let stranger: Account;
let organisation: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`trial-${run}@example.com`}, 'Trial', 'Trial shop') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`trial-${run}`}, 'Trial shop', null) as id`);
  const [o] = await db().execute<Row>(sql`
    select a.id, a.email, s.organisation_id from commerce.accounts a, commerce.stores s
     where lower(a.email) = ${`trial-${run}@example.com`} and s.id = ${String(store.id)}::uuid`);
  owner = { id: String(o.id), email: String(o.email), name: "Trial", platformAdmin: false };
  organisation = String(o.organisation_id);
  const [s] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`stranger-${run}@example.com`}, 'Stranger') returning id, email`);
  stranger = { id: String(s.id), email: String(s.email), name: "Stranger", platformAdmin: false };
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = null`);
  await db().execute(sql`delete from commerce.organisation_extensions where organisation_id = ${organisation}::uuid`);
  await closeDb();
});

describe("an extension's trial (D748 E5)", () => {
  it("waits for extensions to be sold, and is the account owner's to start", async () => {
    expect(await extensions.startExtensionTrial(owner, organisation, "deals")).toEqual({ ok: false, refusal: "not_launched" });
    await db().execute(sql`update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'`);
    expect(await extensions.startExtensionTrial(stranger, organisation, "deals")).toEqual({ ok: false, refusal: "not_owner" });
  });

  it("runs 14 days with its grace period after, once per account per extension", async () => {
    expect(await extensions.startExtensionTrial(owner, organisation, "deals")).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`
      select source, round(extract(epoch from trial_ends_at - now()) / 86400) as trial_days,
             round(extract(epoch from grace_ends_at - trial_ends_at) / 86400) as grace_days, size_id is not null as sized
        from commerce.organisation_extensions where organisation_id = ${organisation}::uuid and extension_id = 'deals'`);
    expect(row).toEqual({ source: "trial", trial_days: "14", grace_days: "14", sized: true });
    expect(await extensions.startExtensionTrial(owner, organisation, "deals")).toEqual({ ok: false, refusal: "had_trial" });
    // Over: read-only, and still no second trial.
    await db().execute(sql`
      update commerce.organisation_extensions set trial_ends_at = now() - interval '30 days', grace_ends_at = now() - interval '16 days'
       where organisation_id = ${organisation}::uuid and extension_id = 'deals'`);
    expect(await extensions.startExtensionTrial(owner, organisation, "deals")).toEqual({ ok: false, refusal: "had_trial" });
  });

  it("is listed on the Extensions page with the account's standing and a price from", async () => {
    const listed = await extensions.accountExtensions(organisation, "NOK");
    expect(listed.find((e) => e.id === "deals")).toMatchObject({ state: "read_only", source: "trial" });
    expect(listed.find((e) => e.id === "work")).toMatchObject({ state: "absent", source: null, priceFrom: { currency: "NOK" } });
  });

  it("is never Kaizena Flow's own account's", async () => {
    const [platform] = await db().execute<Row>(sql`select id from commerce.organisations where platform`);
    const [admin] = await db().execute<Row>(sql`
      select m.account_id from commerce.organisation_members m where m.organisation_id = ${String(platform.id)}::uuid and m.role = 'owner' limit 1`);
    if (!admin) return; // A database whose platform account has no owner member yet.
    const result = await extensions.startExtensionTrial({ ...owner, id: String(admin.account_id) }, String(platform.id), "work");
    expect(result).toEqual({ ok: false, refusal: "platform" });
  });
});
