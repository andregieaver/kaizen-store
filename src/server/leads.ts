import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";
import { LEAD_WINDOW_DAYS, leadDealTitle, leadsFrom, type Lead, type LeadKind } from "@/lib/leads";
import { featureOn } from "@/lib/store-features";

import { audit, type Membership } from "./auth";
import { createCustomer, customerByEmail } from "./customer-staff";
import { createDeal, linkThing, pipelinesOf } from "./deals";
import { memberCan } from "./permissions";
import { col, typedRows } from "./typed-rows";

/**
 * A leads inbox (S4 of `docs/own-books-and-sales.md`, D475): people who asked a store for something in the last 90 days but are not its
 * customers yet, read where their requests are (quote requests, questions and forms, chats, new subscribers), and what staff decided about
 * each (`commerce.lead_decisions`). Read by whoever may read customers while Deals is on; decided by whoever may change them. Audited as
 * `lead.*` with ids only, never an address.
 */

const WRITE = "customers:write" as const;
export type LeadResult = { ok: true; dealId: string | null } | { ok: false; problem: "forbidden" | "not_found" | "no_pipeline" | "failed" };

const row = z.object({
  kind: z.enum(["quote", "question", "chat", "subscriber"]),
  id: col.uuid,
  at: col.timestamp,
  email: col.text,
  name: col.textOrNull,
  excerpt: col.textOrNull,
  customer: col.bool,
  in_deal: col.bool,
  decided_at: col.timestampOrNull,
});

/** Every request in the window, with whether its person is a customer, in an open deal, and when staff last decided about them. */
async function leadRows(storeId: string, email: string | null = null) {
  return typedRows(
    row,
    sql`
      with src as (
        select 'quote' as kind, d.id, d.created_at as at, lower(btrim(coalesce(c.email, nullif(d.email, '')))) as email,
               nullif(c.name, '') as name, d.request_note as excerpt
          from commerce.draft_orders d
          left join commerce.customers c on c.store_id = d.store_id and c.id = d.customer_id
         where d.store_id = ${storeId}::uuid and d.source = 'quote' and d.status in ('open', 'sent')
           and d.created_at >= now() - make_interval(days => ${LEAD_WINDOW_DAYS})
        union all
        select case when f.kind = 'quote' then 'quote' else 'question' end, f.id, f.created_at, lower(btrim(f.email)),
               nullif(f.payload ->> 'name', ''), nullif(f.payload ->> 'message', '')
          from commerce.form_submissions f
         where f.store_id = ${storeId}::uuid and f.kind in ('message', 'quote') and f.email is not null
           and f.created_at >= now() - make_interval(days => ${LEAD_WINDOW_DAYS})
        union all
        select 'chat', s.id, s.created_at, lower(btrim(s.contact_email)), nullif(s.contact_name, ''), null
          from commerce.support_conversations s
         where s.store_id = ${storeId}::uuid and s.contact_email is not null
           and s.created_at >= now() - make_interval(days => ${LEAD_WINDOW_DAYS})
        union all
        select 'subscriber', m.id, coalesce(m.confirmed_at, m.created_at), lower(btrim(m.email)), nullif(m.name, ''), null
          from commerce.marketing_subscribers m
         where m.store_id = ${storeId}::uuid and m.status = 'subscribed'
           and coalesce(m.confirmed_at, m.created_at) >= now() - make_interval(days => ${LEAD_WINDOW_DAYS})
      )
      select src.kind, src.id, src.at, src.email, src.name, src.excerpt,
             exists (select 1 from commerce.orders o
                      where o.store_id = ${storeId}::uuid and lower(o.email) = src.email and o.copied_from is null
                        and o.restricted_at is null and o.status in ('paid', 'fulfilled', 'closed')) as customer,
             exists (select 1 from commerce.deals dl join commerce.customers dc on dc.store_id = dl.store_id and dc.id = dl.customer_id
                      where dl.store_id = ${storeId}::uuid and dl.status = 'open' and lower(dc.email) = src.email) as in_deal,
             (select ld.decided_at from commerce.lead_decisions ld where ld.store_id = ${storeId}::uuid and ld.email = src.email) as decided_at
        from src
       where src.email is not null and src.email <> '' and (${email}::text is null or src.email = ${email}::text)
       order by src.at desc
       limit 1000
    `,
  );
}

/** The store's leads: one a person, the newest first (`leadsFrom()`). */
export async function leadsOf(storeId: string): Promise<Lead[]> {
  const rows = await leadRows(storeId);
  return leadsFrom(rows.map((r) => ({ kind: r.kind, id: r.id, at: r.at, excerpt: r.excerpt, email: r.email, name: r.name, customer: r.customer, inDeal: r.in_deal, decidedAt: r.decided_at })));
}

async function decide(member: Membership, email: string, decision: "dismissed" | "deal", dealId: string | null): Promise<void> {
  await db().execute(sql`
    insert into commerce.lead_decisions (store_id, email, decision, deal_id, decided_by)
    values (${member.store.id}::uuid, ${email}, ${decision}, ${dealId}::uuid, ${member.account.id}::uuid)
    on conflict (store_id, email) do update set decision = excluded.decision, deal_id = excluded.deal_id, decided_by = excluded.decided_by, decided_at = now()
  `);
}

const writable = (member: Membership) => memberCan(member, WRITE) && featureOn(member.store, "sales");
const addressOf = normaliseEmail;

/** A lead dismissed: out of the inbox until they ask for something again. */
export async function dismissLead(member: Membership, email: string): Promise<LeadResult> {
  if (!writable(member)) return { ok: false, problem: "forbidden" };
  const address = addressOf(email);
  if ((await leadRows(member.store.id, address)).length === 0) return { ok: false, problem: "not_found" };
  await decide(member, address, "dismissed", null);
  await audit(member.account.id, member.store.id, "lead.dismissed", {}, { area: "customers" });
  return { ok: true, dealId: null };
}

/**
 * A lead made a deal: the person becomes a customer of the store if they are not one (D366's rules: no password, nothing emailed), and a
 * deal about them opens in the first stage of the store's first pipeline, owned by whoever made it, named after them and what they asked for
 * last; a quote they asked for is linked to it, so its value is the quote's. Then they leave the inbox.
 */
export async function makeLeadDeal(member: Membership, email: string, kinds: Record<LeadKind, string>): Promise<LeadResult> {
  if (!writable(member)) return { ok: false, problem: "forbidden" };
  const address = addressOf(email);
  const [lead] = await leadsOf(member.store.id).then((all) => all.filter((l) => l.email === address));
  if (!lead) return { ok: false, problem: "not_found" };
  const [pipeline] = await pipelinesOf(member.store.id);
  const stage = pipeline?.stages[0];
  if (!pipeline || !stage) return { ok: false, problem: "no_pipeline" };

  let customerId = await customerByEmail(db(), member.store.id, address);
  if (!customerId) {
    const made = await createCustomer(member, { email: address, name: lead.name ?? "" });
    if (!made.ok) return { ok: false, problem: "failed" };
    customerId = made.id;
  }
  const deal = await createDeal(member, {
    title: leadDealTitle(lead, kinds),
    customerId,
    ownerId: member.account.id,
    pipelineId: pipeline.id,
    stageId: stage.id,
  });
  if (!deal.ok) return { ok: false, problem: "failed" };
  // The quote they asked for, the newest, is the deal's: its value counts. Linking needs `orders:read`; without it the deal stands alone.
  const quote = lead.items.find((i) => i.kind === "quote");
  if (quote) {
    const [draft] = await db().execute<{ id: string }>(sql`select id from commerce.draft_orders where store_id = ${member.store.id}::uuid and id = ${quote.id}::uuid`);
    if (draft) await linkThing(member, deal.id, "draft", quote.id);
  }
  await decide(member, address, "deal", deal.id);
  await audit(member.account.id, member.store.id, "lead.deal_made", { deal: deal.id }, { area: "customers", target: { type: "deal", id: deal.id } });
  return { ok: true, dealId: deal.id };
}
