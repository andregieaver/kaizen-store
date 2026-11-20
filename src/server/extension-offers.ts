import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { offerCandidates, offerDue, type OfferFacts, type OfferMemory } from "@/lib/extension-offers";
import { EXTENSION_TRIAL_DAYS, STORE_ONLY_EXTENSIONS, isExtensionId, type ExtensionId } from "@/lib/extensions";
import { formatMoney } from "@/lib/money";
import { can, type PermissionHolder } from "@/lib/permissions";

import { accountCurrency } from "./account-billing";
import type { Account } from "./auth";
import { accountExtensions, startExtensionTrial } from "./extensions";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The AI manager's extension suggestions (D748 E9, D852, `docs/extensions.md` 6): `extension_offers` reads the store's own records and
 * returns at most one extension the account has never tried, with the fact behind it and its price from the price list, within the limits
 * of `offerDue()` (the offer is kept as made when it is returned); `declined` keeps the owner's no. `start_extension_trial` waits for the
 * owner's yes and then starts the trial as the Try free button does (`startTrialOnYes()`).
 */

type OfferContext = { account: Account; store: Store | null; holder?: PermissionHolder };

const FACTS = z.object({ messages: col.int, subscribers: col.int, leads: col.int, page_views: col.int });

/** What the store's own records say: counted where they are kept, each over its window. */
export async function offerFacts(storeId: string): Promise<OfferFacts> {
  const row = await typedRow(
    FACTS,
    sql`
      select
        (select count(*)::int from commerce.support_conversations c where c.store_id = ${storeId}::uuid and c.created_at >= now() - interval '7 days')
          + (select count(*)::int from commerce.form_responses f where f.store_id = ${storeId}::uuid and f.created_at >= now() - interval '7 days') as messages,
        (select count(*)::int from commerce.marketing_subscribers m where m.store_id = ${storeId}::uuid and m.status = 'subscribed') as subscribers,
        (select count(*)::int from commerce.form_responses f where f.store_id = ${storeId}::uuid and f.created_at >= now() - interval '30 days')
          + (select count(*)::int from commerce.draft_orders d where d.store_id = ${storeId}::uuid and d.source = 'quote' and d.created_at >= now() - interval '30 days') as leads,
        coalesce((select sum(v.page_views)::int from commerce.visits v where v.store_id = ${storeId}::uuid and v.day >= current_date - 30), 0) as page_views
    `,
  );
  return { customerMessages7d: row?.messages ?? 0, subscribers: row?.subscribers ?? 0, leads30d: row?.leads ?? 0, pageViews30d: row?.page_views ?? 0 };
}

const FACT_WORDS: Record<keyof OfferFacts, string> = {
  customerMessages7d: "customer conversations and contact form messages in the last 7 days",
  subscribers: "people who said yes to marketing email",
  leads30d: "contact form messages and quote requests in the last 30 days",
  pageViews30d: "page views in the last 30 days",
};

/** The account the store belongs to, for its owner; null with the reason it has none to offer. */
function accountOf(ctx: OfferContext): { organisationId: string; store: Store } | string {
  if (!ctx.store) return "Extensions are offered in a store's admin, not on the platform.";
  if (!ctx.store.organisationId) return "This store has no account to add extensions to.";
  if (ctx.holder && !can(ctx.holder, "owner")) return "Only the account's owner adds extensions.";
  return { organisationId: ctx.store.organisationId, store: ctx.store };
}

/** `extension_offers`: at most one fact-based offer due now, kept as made; or, with `declined`, the owner's no kept. */
export async function extensionOffersTool(ctx: OfferContext, input: { declined?: string }) {
  const place = accountOf(ctx);
  if (typeof place === "string") return { offer: null, note: place };
  if (input.declined) {
    if (!isExtensionId(input.declined)) throw new OwnerToolError("There is no such extension.");
    await db().execute(sql`
      insert into commerce.extension_offers (organisation_id, extension_id, declined_at) values (${place.organisationId}::uuid, ${input.declined}, now())
      on conflict (organisation_id, extension_id) do update set declined_at = now()
    `);
    return { recorded: true, note: "Kept: it is not offered again for 90 days." };
  }
  const now = new Date();
  const currency = await accountCurrency(place.organisationId);
  const [extensions, facts, memory] = await Promise.all([accountExtensions(place.organisationId, currency, now), offerFacts(place.store.id), offerMemory(place.organisationId)]);
  // Only what the account has never had, nor tried: a trial is once per account and extension. A workspace has no site for A/B tests.
  const offerable = extensions
    .filter((e) => e.state === "absent" && e.source === null && e.priceFrom && !(place.store.workspace && STORE_ONLY_EXTENSIONS.includes(e.id)))
    .map((e) => e.id);
  const due = offerCandidates(facts, offerable).filter((c) => offerDue(memory.get(c.extension), now));
  const first = due[0];
  if (!first) return { offer: null, note: "Nothing to offer now: no extension the account lacks has a fact behind it, or it was offered lately." };
  const extension = extensions.find((e) => e.id === first.extension)!;
  await db().execute(sql`
    insert into commerce.extension_offers (organisation_id, extension_id, offered_at) values (${place.organisationId}::uuid, ${first.extension}, now())
    on conflict (organisation_id, extension_id) do update set offered_at = now()
  `);
  return {
    offer: {
      extension: first.extension,
      name: extension.name,
      what_it_does: extension.description,
      fact: `${first.fact.count} ${FACT_WORDS[first.fact.kind]}`,
      price_from: formatMoney(extension.priceFrom!.amountMinor, extension.priceFrom!.currency, "en-GB") + " a month, without VAT",
      free_trial_days: EXTENSION_TRIAL_DAYS,
    },
    note: "Offer it once, in a sentence, with this fact and price, only if it fits what the person asked. If they say yes, call start_extension_trial; if no, call extension_offers with declined.",
  };
}

async function offerMemory(organisationId: string): Promise<Map<ExtensionId, OfferMemory>> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, offered_at: col.timestampOrNull, declined_at: col.timestampOrNull }),
    sql`select extension_id, offered_at, declined_at from commerce.extension_offers where organisation_id = ${organisationId}::uuid`,
  );
  return new Map(
    rows.filter((r) => isExtensionId(r.extension_id)).map((r) => [r.extension_id as ExtensionId, { offeredAt: r.offered_at ? new Date(r.offered_at) : null, declinedAt: r.declined_at ? new Date(r.declined_at) : null }]),
  );
}

/** Why `start_extension_trial` cannot wait for a yes, before it is kept: the same refusals the trial itself would give. */
export async function preflightExtensionTrial(ctx: OfferContext, input: { extension?: unknown }): Promise<string | null> {
  const place = accountOf(ctx);
  if (typeof place === "string") return place;
  if (!isExtensionId(input.extension)) return "There is no such extension.";
  const extensions = await accountExtensions(place.organisationId, await accountCurrency(place.organisationId));
  const e = extensions.find((x) => x.id === input.extension);
  if (!e || e.state !== "absent") return "The account already has it.";
  if (e.source !== null) return "The account has had its free trial of it.";
  return null;
}

/** The owner said yes to `start_extension_trial`: the trial starts as the Try free button starts it (`startExtensionTrial()`). */
export async function startTrialOnYes(ctx: OfferContext, args: Record<string, unknown>): Promise<{ done: string }> {
  const place = accountOf(ctx);
  if (typeof place === "string") throw new OwnerToolError(place);
  if (!isExtensionId(args.extension)) throw new OwnerToolError("There is no such extension.");
  const result = await startExtensionTrial(ctx.account, place.organisationId, args.extension);
  if (!result.ok) {
    throw new OwnerToolError(
      { not_owner: "Only the account's owner starts a trial.", platform: "Kaizena Flow has every extension.", not_launched: "Every account has every extension for now.", has_it: "The account already has it.", had_trial: "The account has had its free trial of it." }[result.refusal],
    );
  }
  return { done: `The free trial has started: ${EXTENSION_TRIAL_DAYS} days.` };
}
