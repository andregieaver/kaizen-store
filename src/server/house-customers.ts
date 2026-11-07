import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import {
  SIGNUP_PIPELINE,
  houseTags,
  isHouseTagKey,
  signupDeal,
  signupTitle,
  type PersonFacts,
  type SignupStage,
} from "@/lib/house-customers";

import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own customers (D467, `docs/platform-parity-plan.md` step 2): the owners of its customers' stores and the people who applied
 * for one, kept as customers of Kaizena Flow's own store (D466) by `syncHouseCustomers()`, the five-minute dispatcher's `houseCustomers`, the
 * only writer of `commerce.house_customer_links`.
 *
 * - A person is an account that owns a customer's store, or the latest confirmed application of an address (a self-serve one once its link
 *   was opened); one customer per address, its name filled in only while empty, so what staff typed stays.
 * - The platform's tags (`HOUSE_TAG`, a plan's `Plan: …`) are kept true on each person and taken away when they no longer hold; staff's own
 *   tags are never touched. Nobody is subscribed to anything: news goes only to those who asked for it (the newsletter on Kaizena Flow's pages).
 * - An application opens a deal on the Sign-ups pipeline (made the first time), moved forward as the application is approved and its store
 *   opened, won when the store's plan is paid with real money (Stripe's live mode) and lost when the application is declined (`closed_via` `platform`). A deal a person moved to
 *   another pipeline or closed is left as it is, and a deal is never moved back.
 * - An erased account (D377) takes everything of its address in Kaizena Flow's store with it. A person who is neither an owner nor an applicant
 *   any more (an application blanked after its period, PSI REG-05) is forgotten when nothing else of theirs is kept there: no subscription,
 *   note, staff tag, conversation, privacy request or other deal.
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export type HouseSync = {
  people: number;
  added: number;
  tagsAdded: number;
  tagsRemoved: number;
  dealsOpened: number;
  dealsChanged: number;
  forgotten: number;
};

const EMPTY: HouseSync = {
  people: 0,
  added: 0,
  tagsAdded: 0,
  tagsRemoved: 0,
  dealsOpened: 0,
  dealsChanged: 0,
  forgotten: 0,
};

/** Kaizena Flow's own store, or null on a database without one. */
export async function houseStoreId(runner?: Tx): Promise<string | null> {
  const row = await typedRow(
    z.object({ id: col.uuid.nullable() }),
    sql`select commerce.house_store() as id`,
    runner,
  );
  return row?.id ?? null;
}

/**
 * Kaizena Flow's own store, for what a page draws (`ThemeStoreSection` on its store's pages, D484): cached, as the store is made once by
 * its migration (D466) and never changes. An uncached read there stops a store's prerendered page from drawing at all.
 */
export async function houseStoreIdCached(): Promise<string | null> {
  "use cache";
  cacheLife("days");
  cacheTag("house-store");
  return houseStoreId();
}

/** The house customer of an account (an owner), for the platform's Customers page: null when there is none yet. */
export async function houseCustomerOfAccount(
  accountId: string,
): Promise<{ storeSlug: string; customerId: string } | null> {
  return typedRow(
    z
      .object({ store_slug: col.text, customer_id: col.uuid })
      .transform((r) => ({
        storeSlug: r.store_slug,
        customerId: r.customer_id,
      })),
    sql`
      select s.slug as store_slug, l.customer_id from commerce.house_customer_links l join commerce.stores s on s.id = l.store_id and s.house
      where l.account_id = ${accountId}::uuid
    `,
  );
}

/** A customer's language in Kaizena Flow's store: Norwegian for a Norwegian admin or application, else English. */
const localeOf = (lang: string | null): string =>
  lang && /^(nb|nn|no)\b/i.test(lang) ? "nb-NO" : "en-GB";

const personRow = z.object({
  email: col.text,
  account_id: col.uuid.nullable(),
  request_id: col.uuid.nullable(),
  name: col.text,
  lang: col.textOrNull,
  store_name: col.textOrNull,
  status: z.enum(["pending", "approved", "declined"]).nullable(),
  store_opened: col.bool,
  plan_paid: col.bool,
  owner: col.bool,
  plans: z.array(z.string()),
  trial: col.bool,
  overdue: col.bool,
  store_open: col.bool,
});
type Person = z.infer<typeof personRow>;

/** Everyone the platform knows as an owner or an applicant, one row per address, with what decides their tags and their deal. */
function people(runner: Tx): Promise<Person[]> {
  return typedRows(
    personRow,
    sql`
      with owned as (
        select a.id as account_id, lower(a.email) as email, coalesce(a.name, '') as name, a.admin_locale as lang, s.id as store_id,
               s.setup_completed_at is not null as opened, b.status, b.trial_ends_at, p.name as plan
        from commerce.accounts a
        join commerce.store_members m on m.account_id = a.id and m.role = 'owner' and m.disabled_at is null
        join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)
        left join commerce.store_billing b on b.store_id = s.id
        left join commerce.plans p on p.id = b.plan_id
        where a.disabled_at is null and a.email not like '%.invalid'
      ),
      owners as (
        select account_id, email, max(name) as name, max(lang) as lang,
               coalesce(array_agg(distinct plan) filter (where plan is not null and status in ('trialing', 'active', 'past_due')), '{}') as plans,
               coalesce(bool_or(status = 'trialing' or (trial_ends_at > now() and coalesce(status, '') not in ('active', 'past_due'))), false) as trial,
               coalesce(bool_or(status in ('past_due', 'unpaid')), false) as overdue,
               bool_or(opened) as store_open
        from owned group by account_id, email
      ),
      requests as (
        select distinct on (lower(r.email)) r.id as request_id, lower(r.email) as email, coalesce(r.name, '') as name, r.locale as lang,
               r.store_name, r.status::text as status,
               coalesce((select s.setup_completed_at is not null from commerce.stores s where s.id = r.store_id), false) as store_opened,
               coalesce((select b.status in ('active', 'past_due') and b.mode = 'live' from commerce.store_billing b where b.store_id = r.store_id), false) as plan_paid
        from commerce.access_requests r
        where r.email not like '%.invalid' and (not r.self_serve or r.confirmed_at is not null)
        order by lower(r.email), r.created_at desc, r.id
      )
      select coalesce(o.email, q.email) as email, o.account_id, q.request_id,
             coalesce(nullif(o.name, ''), q.name, '') as name, coalesce(o.lang, q.lang) as lang, q.store_name, q.status,
             coalesce(q.store_opened, false) as store_opened, coalesce(q.plan_paid, false) as plan_paid,
             o.account_id is not null as owner, coalesce(o.plans, '{}') as plans,
             coalesce(o.trial, false) as trial, coalesce(o.overdue, false) as overdue, coalesce(o.store_open, false) as store_open
      from owners o full join requests q on q.email = o.email
      order by 1
    `,
    runner,
  );
}

/**
 * Keeps Kaizena Flow's own store's customers in step with its owners and applicants (see the file's comment). One run at a time (an advisory
 * lock; a second run returns at once); never throws on one person: a person that fails is logged and the rest go on.
 */
export async function syncHouseCustomers(): Promise<HouseSync> {
  return db().transaction(async (tx) => {
    const [locked] = await tx.execute<{ ok: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('house_customers')) as ok`,
    );
    if (!locked?.ok) return EMPTY;
    const house = await houseStoreId(tx);
    if (!house) return EMPTY;
    const out: HouseSync = { ...EMPTY };

    out.forgotten += await forgetErasedAccounts(tx, house);
    const everyone = await people(tx);
    out.people = everyone.length;

    // One customer per address: made when missing, a name filled in only while it is empty.
    const rows = everyone.map((p) => ({
      email: p.email,
      name: p.name.slice(0, 200),
      locale: localeOf(p.lang),
    }));
    const added = await tx.execute(sql`
      insert into commerce.customers (store_id, email, name, locale)
      select ${house}::uuid, p.email, p.name, p.locale from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as p(email text, name text, locale text)
      where not exists (select 1 from commerce.customers c where c.store_id = ${house}::uuid and lower(c.email) = p.email)
      returning id
    `);
    out.added = added.length;
    await tx.execute(sql`
      update commerce.customers c set name = p.name, updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as p(email text, name text, locale text)
      where c.store_id = ${house}::uuid and lower(c.email) = p.email and c.name = '' and p.name <> ''
    `);
    const ids = new Map(
      (
        await typedRows(
          z.object({ id: col.uuid, email: col.text }),
          sql`
            select id, lower(email) as email from commerce.customers
            where store_id = ${house}::uuid and lower(email) in (select jsonb_array_elements_text(${JSON.stringify(everyone.map((p) => p.email))}::jsonb))
          `,
          tx,
        )
      ).map((r) => [r.email, r.id]),
    );

    // The links: an account or a request belongs to one customer, its address's; what moved is let go first.
    const links = everyone.flatMap((p) =>
      ids.has(p.email)
        ? [
            {
              customer: ids.get(p.email)!,
              account: p.account_id,
              request: p.request_id,
            },
          ]
        : [],
    );
    await tx.execute(sql`
      update commerce.house_customer_links l set account_id = null, updated_at = now()
      where l.store_id = ${house}::uuid and l.account_id is not null and not exists (
        select 1 from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as k(customer uuid, account uuid, request uuid)
        where k.customer = l.customer_id and k.account = l.account_id)
    `);
    await tx.execute(sql`
      update commerce.house_customer_links l set request_id = null, updated_at = now()
      where l.store_id = ${house}::uuid and l.request_id is not null and not exists (
        select 1 from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as k(customer uuid, account uuid, request uuid)
        where k.customer = l.customer_id and k.request = l.request_id)
    `);
    await tx.execute(sql`
      insert into commerce.house_customer_links (store_id, customer_id, account_id, request_id)
      select ${house}::uuid, k.customer, k.account, k.request from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as k(customer uuid, account uuid, request uuid)
      on conflict (store_id, customer_id) do update set account_id = excluded.account_id, request_id = excluded.request_id, updated_at = now()
        where (commerce.house_customer_links.account_id, commerce.house_customer_links.request_id) is distinct from (excluded.account_id, excluded.request_id)
    `);

    const tagged = await keepTags(tx, house, everyone);
    out.tagsAdded = tagged.added;
    out.tagsRemoved = tagged.removed;

    const deals = await keepDeals(tx, house, everyone, ids);
    out.dealsOpened = deals.opened;
    out.dealsChanged = deals.changed;

    out.forgotten += await forgetLeft(tx, house);
    return out;
  });
}

/** Every platform tag made true and every one that no longer holds taken away; a person at the tag limit gets no more. */
async function keepTags(
  tx: Tx,
  house: string,
  everyone: Person[],
): Promise<{ added: number; removed: number }> {
  const want: { email: string; key: string; label: string }[] = [];
  for (const p of everyone) {
    const facts: PersonFacts = {
      owner: p.owner,
      waiting: p.status === "pending",
      plans: p.plans,
      trial: p.trial,
      overdue: p.overdue,
      storeOpen: p.store_open,
    };
    for (const tag of houseTags(facts))
      want.push({ email: p.email, key: tag.key, label: tag.label });
  }
  const held = await typedRows(
    z.object({ email: col.text, key: col.text }),
    sql`select email, key from commerce.customer_tags where store_id = ${house}::uuid and created_by is null`,
    tx,
  );
  const wanted = new Set(want.map((w) => `${w.email}\n${w.key}`));
  const stale = held.filter(
    (h) => isHouseTagKey(h.key) && !wanted.has(`${h.email}\n${h.key}`),
  );
  if (stale.length > 0) {
    await tx.execute(sql`
      delete from commerce.customer_tags t using jsonb_to_recordset(${JSON.stringify(stale)}::jsonb) as s(email text, key text)
      where t.store_id = ${house}::uuid and t.email = s.email and t.key = s.key and t.created_by is null
    `);
  }
  const have = new Set(held.map((h) => `${h.email}\n${h.key}`));
  const missing = want.filter((w) => !have.has(`${w.email}\n${w.key}`));
  let added = 0;
  if (missing.length > 0) {
    const rows = await tx.execute(sql`
      insert into commerce.customer_tags (store_id, email, key, label)
      select ${house}::uuid, m.email, m.key, m.label from jsonb_to_recordset(${JSON.stringify(missing)}::jsonb) as m(email text, key text, label text)
      where (select count(*) from commerce.customer_tags t where t.store_id = ${house}::uuid and t.email = m.email) < 40
      on conflict do nothing
      returning key
    `);
    added = rows.length;
  }
  return { added, removed: stale.length };
}

/** The Sign-ups pipeline's id and its stages' ids in order, made the first time. */
async function signupPipeline(
  tx: Tx,
  house: string,
): Promise<{ id: string; stages: string[] }> {
  const read = () =>
    typedRows(
      z.object({
        id: col.uuid,
        stage_id: col.uuid.nullable(),
        position: col.int.nullable(),
      }),
      sql`
        select p.id, s.id as stage_id, s.position from commerce.deal_pipelines p
        left join commerce.deal_stages s on s.store_id = p.store_id and s.pipeline_id = p.id
        where p.store_id = ${house}::uuid and p.name = ${SIGNUP_PIPELINE.name}
        order by p.created_at, p.id, s.position
      `,
      tx,
    );
  let rows = await read();
  if (rows.length === 0) {
    const made = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.deal_pipelines (store_id, name) values (${house}::uuid, ${SIGNUP_PIPELINE.name}) returning id`,
      tx,
    );
    for (const [position, name] of SIGNUP_PIPELINE.stages.entries()) {
      await tx.execute(
        sql`insert into commerce.deal_stages (store_id, pipeline_id, name, position) values (${house}::uuid, ${made!.id}::uuid, ${name}, ${position})`,
      );
    }
    rows = await read();
  }
  const id = rows[0].id;
  return {
    id,
    stages: rows
      .filter((r) => r.id === id && r.stage_id)
      .map((r) => r.stage_id!),
  };
}

/** A deal per application, kept where the application stands. */
async function keepDeals(
  tx: Tx,
  house: string,
  everyone: Person[],
  ids: Map<string, string>,
): Promise<{ opened: number; changed: number }> {
  const applicants = everyone.filter(
    (p) => p.request_id && p.status && ids.has(p.email),
  );
  if (applicants.length === 0) return { opened: 0, changed: 0 };
  const pipeline = await signupPipeline(tx, house);
  if (pipeline.stages.length === 0) return { opened: 0, changed: 0 };
  const stageAt = (stage: SignupStage) =>
    pipeline.stages[Math.min(stage, pipeline.stages.length - 1)];
  const current = new Map(
    (
      await typedRows(
        z.object({
          customer_id: col.uuid,
          deal_id: col.uuid.nullable(),
          pipeline_id: col.uuid.nullable(),
          stage_id: col.uuid.nullable(),
          status: col.textOrNull,
        }),
        sql`
          select l.customer_id, d.id as deal_id, d.pipeline_id, d.stage_id, d.status from commerce.house_customer_links l
          left join commerce.deals d on d.store_id = l.store_id and d.id = l.deal_id
          where l.store_id = ${house}::uuid
        `,
        tx,
      )
    ).map((r) => [r.customer_id, r]),
  );
  let opened = 0;
  let changed = 0;
  for (const p of applicants) {
    const customer = ids.get(p.email)!;
    const want = signupDeal({
      status: p.status!,
      storeOpened: p.store_opened,
      planPaid: p.plan_paid,
    });
    const now = current.get(customer);
    try {
      // A savepoint each: one deal that fails is logged, and the run goes on.
      const result = await tx.transaction(async (sp) => {
        if (!now?.deal_id) {
          const made = await typedRow(
            z.object({ id: col.uuid }),
            sql`
            insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency)
            values (${house}::uuid, ${signupTitle(p.store_name, p.email)}, ${customer}::uuid, ${pipeline.id}::uuid, ${stageAt(want.stage)}::uuid,
              (select m.currency from commerce.markets m where m.store_id = ${house}::uuid order by m.active desc, m.code limit 1))
            returning id
          `,
            sp,
          );
          await sp.execute(
            sql`update commerce.house_customer_links set deal_id = ${made!.id}::uuid, updated_at = now() where store_id = ${house}::uuid and customer_id = ${customer}::uuid`,
          );
          return {
            opened: 1,
            changed: await settle(sp, house, made!.id, want.outcome),
          };
        }
        // A deal a person closed, or moved to another pipeline, is theirs now.
        if (now.status !== "open" || now.pipeline_id !== pipeline.id)
          return { opened: 0, changed: 0 };
        const at = pipeline.stages.indexOf(now.stage_id ?? "");
        let moved = 0;
        if (want.stage > at) {
          await sp.execute(
            sql`update commerce.deals set stage_id = ${stageAt(want.stage)}::uuid, updated_by = null, updated_at = now() where store_id = ${house}::uuid and id = ${now.deal_id}::uuid`,
          );
          moved = 1;
        }
        return {
          opened: 0,
          changed: moved + (await settle(sp, house, now.deal_id, want.outcome)),
        };
      });
      opened += result.opened;
      changed += result.changed;
    } catch (error) {
      log("error", "house_customers.deal_failed", { customer }, error);
    }
  }
  return { opened, changed };
}

/** Closes an open deal as its application ended: won through `deal_win()` (a plan paid), lost when it was declined. */
async function settle(
  tx: Tx,
  house: string,
  dealId: string,
  outcome: "open" | "won" | "lost",
): Promise<number> {
  if (outcome === "won") {
    const row = await typedRow(
      z.object({ n: col.int }),
      sql`select commerce.deal_win(${house}::uuid, array[${dealId}::uuid], 'platform') as n`,
      tx,
    );
    return row?.n ?? 0;
  }
  if (outcome === "lost") {
    const rows = await tx.execute(sql`
      update commerce.deals set status = 'lost', closed_at = now(), closed_via = 'platform', close_reason = 'Declined', updated_by = null, updated_at = now()
      where store_id = ${house}::uuid and id = ${dealId}::uuid and status = 'open'
      returning id
    `);
    return rows.length;
  }
  return 0;
}

/** Everything of an erased account's address in Kaizena Flow's store (D377): the person asked for it all to go. */
async function forgetErasedAccounts(tx: Tx, house: string): Promise<number> {
  const gone = await typedRows(
    z.object({ customer_id: col.uuid, email: col.text }),
    sql`
      select l.customer_id, lower(c.email) as email from commerce.house_customer_links l
      join commerce.accounts a on a.id = l.account_id and a.disabled_at is not null and a.email like 'erased-%@erased.invalid'
      join commerce.customers c on c.store_id = l.store_id and c.id = l.customer_id
      where l.store_id = ${house}::uuid
    `,
    tx,
  );
  let n = 0;
  for (const g of gone) {
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(
          sql`delete from commerce.marketing_subscribers where store_id = ${house}::uuid and lower(email) = ${g.email}`,
        );
        await sp.execute(
          sql`delete from commerce.customer_tags where store_id = ${house}::uuid and email = ${g.email}`,
        );
        await sp.execute(
          sql`delete from commerce.customer_notes where store_id = ${house}::uuid and email = ${g.email}`,
        );
        await sp.execute(
          sql`delete from commerce.deals where store_id = ${house}::uuid and customer_id = ${g.customer_id}::uuid`,
        );
        await sp.execute(
          sql`delete from commerce.customers where store_id = ${house}::uuid and id = ${g.customer_id}::uuid`,
        );
      });
      n += 1;
    } catch (error) {
      log(
        "error",
        "house_customers.erase_failed",
        { customer: g.customer_id },
        error,
      );
    }
  }
  return n;
}

/**
 * A person who is neither an owner nor an applicant any more, with nothing else of theirs in Kaizena Flow's store: their deal from the sync, the
 * platform's tags and the customer go. Anyone with more is kept, as any store's customer is.
 */
async function forgetLeft(tx: Tx, house: string): Promise<number> {
  const left = await typedRows(
    z.object({
      customer_id: col.uuid,
      email: col.text,
      deal_id: col.uuid.nullable(),
    }),
    sql`
      select l.customer_id, lower(c.email) as email, l.deal_id from commerce.house_customer_links l
      join commerce.customers c on c.store_id = l.store_id and c.id = l.customer_id
      where l.store_id = ${house}::uuid and l.account_id is null and l.request_id is null
        and not exists (select 1 from commerce.marketing_subscribers x where x.store_id = l.store_id and lower(x.email) = lower(c.email))
        and not exists (select 1 from commerce.customer_notes x where x.store_id = l.store_id and x.email = lower(c.email))
        and not exists (select 1 from commerce.customer_tags x where x.store_id = l.store_id and x.email = lower(c.email) and x.created_by is not null)
        and not exists (select 1 from commerce.support_conversations x where x.store_id = l.store_id and x.customer_id = l.customer_id)
        and not exists (select 1 from commerce.privacy_requests x where x.store_id = l.store_id and x.subject_customer_id = l.customer_id)
        and not exists (select 1 from commerce.deals x where x.store_id = l.store_id and x.customer_id = l.customer_id and x.id is distinct from l.deal_id)
    `,
    tx,
  );
  let n = 0;
  for (const g of left) {
    try {
      await tx.transaction(async (sp) => {
        if (g.deal_id)
          await sp.execute(
            sql`delete from commerce.deals where store_id = ${house}::uuid and id = ${g.deal_id}::uuid`,
          );
        await sp.execute(
          sql`delete from commerce.customer_tags where store_id = ${house}::uuid and email = ${g.email} and created_by is null`,
        );
        await sp.execute(
          sql`delete from commerce.customers where store_id = ${house}::uuid and id = ${g.customer_id}::uuid`,
        );
      });
      n += 1;
    } catch (error) {
      log(
        "error",
        "house_customers.forget_failed",
        { customer: g.customer_id },
        error,
      );
    }
  }
  return n;
}
