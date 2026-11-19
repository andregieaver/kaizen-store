import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * The launch of paid extensions (D748 step E5 part two): every account moved to one plan or given its row, a 60-day trial of each extension an
 * account already uses and its plan does not include, `extensions_launched_at` set once; an account made after it billed through its account
 * with its trial there; and the emails before a trial ends, each once. The launch is the whole database's, so what it changes is put back.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));
// No Stripe: the moves write the accounts' rows; ending other subscriptions is the account move's own test.
vi.mock("./stripe", async (importActual) => ({ ...(await importActual<typeof import("./stripe")>()), platformStripe: () => null }));

const launch = await import("./extension-launch");
const reminders = await import("./extension-reminders");
const trial = await import("./store-trial");

const run = Date.now().toString(36);
let admin: Account;
let planId: string;
let planPriceId: string;
const org: Record<"used" | "plain" | "closed" | "later", { id: string; store: string; email: string }> = {} as never;

/** What the launch writes across the database, read before it so it can be put back. */
let before: { billing: string[]; extensions: string[]; subscriptions: Row[] };

async function makeAccount(key: keyof typeof org): Promise<void> {
  const email = `launch-${key}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${`Launch ${key}`}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`launch-${key}-${run}`}, ${`Launch ${key}`}, null) as id`);
  const [placed] = await db().execute<Row>(sql`select organisation_id from commerce.stores where id = ${String(store.id)}::uuid`);
  org[key] = { id: String(placed.organisation_id), store: String(store.id), email };
}

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`launch-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(a.id), email: String(a.email), name: "Admin", platformAdmin: true };
  const [p] = await db().execute<Row>(sql`insert into commerce.plans (name) values (${`Launch plan ${run}`}) returning id`);
  planId = String(p.id);
  const [pp] = await db().execute<Row>(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${planId}::uuid, 'NOK', 'month', 30000) returning id`);
  planPriceId = String(pp.id);
  // The plan includes email automation.
  await db().execute(sql`
    insert into commerce.plan_extension_grants (plan_id, extension_id, size_id)
    select ${planId}::uuid, 'email_automation', es.id from commerce.extension_sizes es where es.extension_id = 'email_automation' order by es.position limit 1`);

  await makeAccount("used");
  await makeAccount("plain");
  await makeAccount("closed");
  // Uses the support desk and email automation, on the plan that includes email automation.
  await db().execute(sql`
    insert into commerce.store_billing (store_id, plan_id, price_id, mode, subscription_id, status)
    values (${org.used.store}::uuid, ${planId}::uuid, ${planPriceId}::uuid, 'test', ${`sub_launch_${run}`}, 'active')`);
  await db().execute(sql`insert into commerce.support_settings (store_id, mode) values (${org.used.store}::uuid, 'ai_first') on conflict on constraint support_settings_store_key do update set mode = 'ai_first'`);
  await db().execute(sql`insert into commerce.broadcasts (store_id, title) values (${org.used.store}::uuid, 'Spring news')`);
  // In a store trial, using nothing.
  await db().execute(sql`insert into commerce.store_billing (store_id, trial_ends_at) values (${org.plain.store}::uuid, now() + interval '5 days')`);
  // Its only store closed: its records count for nothing.
  await db().execute(sql`insert into commerce.broadcasts (store_id, title) values (${org.closed.store}::uuid, 'Old news')`);
  await db().execute(sql`update commerce.stores set status = 'closed' where id = ${org.closed.store}::uuid`);

  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = null`);
  const [billing, extensions, subscriptions] = await Promise.all([
    db().execute<Row>(sql`select organisation_id::text as id from commerce.organisation_billing`),
    db().execute<Row>(sql`select organisation_id::text || ':' || extension_id as id from commerce.organisation_extensions`),
    db().execute<Row>(sql`select store_id, subscription_id, status from commerce.store_billing where subscription_id is not null`),
  ]);
  before = { billing: billing.map((r) => String(r.id)), extensions: extensions.map((r) => String(r.id)), subscriptions };
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = null`);
  await db().execute(sql`
    delete from commerce.organisation_extensions
     where organisation_id::text || ':' || extension_id not in (select jsonb_array_elements_text(${JSON.stringify(before.extensions)}::jsonb))`);
  await db().execute(sql`
    delete from commerce.organisation_billing where organisation_id::text not in (select jsonb_array_elements_text(${JSON.stringify(before.billing)}::jsonb))`);
  for (const row of before.subscriptions) {
    await db().execute(sql`
      update commerce.store_billing set subscription_id = ${String(row.subscription_id)}, status = ${row.status as string | null}
       where store_id = ${String(row.store_id)}::uuid and subscription_id is null`);
  }
  await db().execute(sql`delete from commerce.plan_extension_grants where plan_id = ${planId}::uuid`);
  await db().execute(sql`update commerce.plans set active = false where id = ${planId}::uuid`);
  await closeDb();
});

describe("the launch of extensions (D748 E5)", () => {
  it("previews the accounts that move and the trials it gives", async () => {
    const preview = await launch.launchPreview();
    expect(preview.launchedAt).toBeNull();
    expect(preview.moving).toBeGreaterThanOrEqual(2);
    expect(preview.trials.find((t) => t.extensionId === "support_desk")?.accounts).toBeGreaterThanOrEqual(1);
    expect(Math.round((new Date(preview.trialsEnd).getTime() - Date.now()) / 86_400_000)).toBe(60);
  });

  it("moves every account, gives the used extensions their plan does not include 60 days, and is sold from then on", async () => {
    const result = await launch.launchExtensions(admin);
    expect(result).toMatchObject({ ok: true });
    const [settings] = await db().execute<Row>(sql`select extensions_launched_at is not null as launched from commerce.platform_settings`);
    expect(settings.launched).toBe(true);

    // The account on a plan keeps its subscription as the account's; the store's own row no longer holds it.
    const [used] = await db().execute<Row>(sql`select plan_id, subscription_id, moved_at is not null as moved from commerce.organisation_billing where organisation_id = ${org.used.id}::uuid`);
    expect(used).toEqual({ plan_id: planId, subscription_id: `sub_launch_${run}`, moved: true });
    const trials = await db().execute<Row>(sql`
      select extension_id, source, round(extract(epoch from trial_ends_at - now()) / 86400) as days,
             round(extract(epoch from grace_ends_at - trial_ends_at) / 86400) as grace
        from commerce.organisation_extensions where organisation_id = ${org.used.id}::uuid order by extension_id`);
    // The support desk in its trial; email automation is the plan's, so no trial.
    expect(trials).toEqual([{ extension_id: "support_desk", source: "trial", days: "60", grace: "14" }]);

    // The account in its store trial: billed through its account, the trial kept, nothing used so no extension.
    const [plain] = await db().execute<Row>(sql`select plan_id, round(extract(epoch from trial_ends_at - now()) / 86400) as days from commerce.organisation_billing where organisation_id = ${org.plain.id}::uuid`);
    expect(plain).toEqual({ plan_id: null, days: "5" });
    // The account with only a closed store: a row of its own, and its closed store's records gave nothing.
    const closed = await db().execute<Row>(sql`select plan_id from commerce.organisation_billing where organisation_id = ${org.closed.id}::uuid`);
    expect(closed).toEqual([{ plan_id: null }]);
    const none = await db().execute<Row>(sql`select 1 from commerce.organisation_extensions where organisation_id in (${org.plain.id}::uuid, ${org.closed.id}::uuid)`);
    expect(none).toEqual([]);
    // No account but Kaizena Flow's own is left billed store by store.
    const left = await db().execute<Row>(sql`
      select o.id from commerce.organisations o where not o.platform and not exists (select 1 from commerce.organisation_billing ob where ob.organisation_id = o.id)`);
    expect(left).toEqual([]);
  });

  it("launches once", async () => {
    expect(await launch.launchExtensions(admin)).toEqual({ ok: false, problems: ["Extensions are on sale already."] });
  });

  it("bills an account made after the launch through its account, with its trial there", async () => {
    await makeAccount("later");
    const [row] = await db().execute<Row>(sql`select trial_ends_at from commerce.organisation_billing where organisation_id = ${org.later.id}::uuid`);
    expect(row).toEqual({ trial_ends_at: null });
    expect(await trial.writeTrial(org.later.store)).toBe(true);
    const [after] = await db().execute<Row>(sql`select round(extract(epoch from trial_ends_at - now()) / 86400) as days from commerce.organisation_billing where organisation_id = ${org.later.id}::uuid`);
    expect(after.days).toBe(String(trial.TRIAL_DAYS));
    const own = await db().execute<Row>(sql`select 1 from commerce.store_billing where store_id = ${org.later.store}::uuid and trial_ends_at is not null`);
    expect(own).toEqual([]);
    const [plan] = await db().execute<Row>(sql`select by_account, trial_ends_at is not null as trial from commerce.store_plans where store_id = ${org.later.store}::uuid`);
    expect(plan).toEqual({ by_account: true, trial: true });
    // Never a second trial.
    expect(await trial.writeTrial(org.later.store)).toBe(false);
  });

  it("emails the owner before a trial ends, once per reminder", async () => {
    // 30 days left of a 60-day trial.
    await db().execute(sql`
      update commerce.organisation_extensions set created_at = now() - interval '30 days', trial_ends_at = now() + interval '29 days 23 hours'
       where organisation_id = ${org.used.id}::uuid and extension_id = 'support_desk'`);
    const sent = async () =>
      db().execute<Row>(sql`
        select to_address, subject from commerce.email_messages
         where kind = 'billing.extension_trial_ending' and idempotency_key like ${`extension-trial:${org.used.id}:%`}`);
    await reminders.sendTrialReminders();
    expect(await sent()).toEqual([{ to_address: org.used.email, subject: "Your free trial ends in 30 days" }]);
    await reminders.sendTrialReminders();
    expect(await sent()).toHaveLength(1);
    // 3 days left: the next reminder, and the one at 14 days is not sent late.
    await db().execute(sql`update commerce.organisation_extensions set trial_ends_at = now() + interval '2 days 12 hours' where organisation_id = ${org.used.id}::uuid and extension_id = 'support_desk'`);
    await reminders.sendTrialReminders();
    expect((await sent()).map((r) => r.subject).sort()).toEqual(["Your free trial ends in 3 days", "Your free trial ends in 30 days"]);
  });
});
