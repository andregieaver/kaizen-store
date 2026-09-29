import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { AI_FEATURES, NO_USAGE, type AiFeature, type AiKind, type AiSource, type UsageAmounts, type UsageRow } from "@/lib/ai-usage";

type Row = Record<string, unknown>;

/**
 * AI usage (D106): every call to a model is recorded here as one row, and
 * read back as the sums the usage pages show. Recording never fails the
 * call it measures, and waits for the insert (a few milliseconds beside a
 * model's answer) so it is not lost when a serverless function ends.
 */

/** What a connection knows about who it was made for: set by `aiFor()`. */
export type UsageContext = {
  /** The store the call is for; null for Kaizen's own. */
  storeId: string | null;
  feature: AiFeature;
  /** The signed-in person who asked, where there is one. */
  accountId: string | null;
};

export type UsageEvent = {
  source: AiSource;
  provider: string;
  model: string;
  kind: AiKind;
  requests?: number;
  failed?: boolean;
  estimated?: boolean;
  amounts?: Partial<UsageAmounts>;
  sessionRef?: string | null;
};

/** Days usage is kept. */
export const USAGE_KEEP_DAYS = 400;

export async function recordUsage(context: UsageContext, event: UsageEvent): Promise<void> {
  const a = { ...NO_USAGE, ...event.amounts };
  const feature = context.feature in AI_FEATURES ? context.feature : "other";
  try {
    await db().execute(sql`
      insert into commerce.ai_usage (
        store_id, owner_account_id, actor_account_id, source, provider, model, kind, feature,
        requests, failed, input_tokens, output_tokens, characters, audio_bytes, audio_seconds, images, estimated, session_ref
      ) values (
        ${context.storeId}::uuid,
        ${
          context.storeId
            ? sql`(select m.account_id from commerce.store_members m where m.store_id = ${context.storeId}::uuid and m.role = 'owner' and m.disabled_at is null order by m.created_at limit 1)`
            : sql`null`
        },
        ${context.accountId}::uuid, ${event.source}, ${event.provider.slice(0, 60)}, ${event.model.slice(0, 200)}, ${event.kind}, ${feature},
        ${event.requests ?? 1}, ${event.failed ? 1 : 0}, ${Math.round(a.inputTokens)}, ${Math.round(a.outputTokens)}, ${Math.round(a.characters)},
        ${Math.round(a.audioBytes)}, ${Math.round(a.audioSeconds)}, ${Math.round(a.images)}, ${event.estimated === true}, ${event.sessionRef ?? null}
      )
    `);
  } catch (error) {
    console.error("[ai-usage] not recorded", error);
  }
}

/** The length of a live voice call, added to the row its start made; only what the person's own page reported, capped at four hours. */
export async function recordLiveSeconds(accountId: string, storeId: string | null, sessionRef: string, seconds: number): Promise<void> {
  const clean = Math.min(4 * 3600, Math.max(0, Math.round(seconds)));
  if (!Number.isFinite(clean) || sessionRef.length > 200) return;
  try {
    await db().execute(sql`
      update commerce.ai_usage set audio_seconds = ${clean}
      where kind = 'live' and session_ref = ${sessionRef} and actor_account_id = ${accountId}::uuid and audio_seconds = 0
        and store_id is not distinct from ${storeId}::uuid
    `);
  } catch (error) {
    console.error("[ai-usage] live seconds not recorded", error);
  }
}

/** Deletes usage older than the kept days (daily). */
export async function pruneUsage(): Promise<number> {
  const rows = await db().execute(sql`delete from commerce.ai_usage where created_at < now() - make_interval(days => ${USAGE_KEEP_DAYS}) returning 1`);
  return rows.length;
}

// Reports ---------------------------------------------------------------------------------------

/** Limits usage to the stores an account owns. */
const owned = (accountId: string | null) =>
  accountId
    ? sql`and u.store_id in (select m.store_id from commerce.store_members m where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null)`
    : sql``;

export type UsageQuery = {
  /** Days back from now; the period's start is midnight UTC that many days ago. */
  days: number;
  /** Only the stores this account owns (an owner's own usage); every store, and Kaizen's own, when null (the platform). */
  ownedBy?: string | null;
  /** Only this store. */
  storeId?: string | null;
};

/**
 * The usage of a period as rows, one per owner, store, key, provider,
 * model and kind: every report (totals, per provider and model, per owner,
 * per store) is a sum of these, worked out in `src/lib/ai-usage.ts`.
 */
export async function usageRows({ days, ownedBy = null, storeId = null }: UsageQuery): Promise<UsageRow[]> {
  const rows = await db().execute<Row>(sql`
    select u.owner_account_id, o.email as owner_email, o.name as owner_name,
      u.store_id, s.slug as store_slug, s.name as store_name,
      u.source, u.provider, u.model, u.kind, u.feature,
      sum(u.requests)::bigint as requests, sum(u.failed)::bigint as failed,
      sum(u.input_tokens)::bigint as input_tokens, sum(u.output_tokens)::bigint as output_tokens,
      sum(u.characters)::bigint as characters, sum(u.audio_seconds)::bigint as audio_seconds, sum(u.images)::bigint as images,
      sum(case when u.estimated then u.requests else 0 end)::bigint as estimated_requests
    from commerce.ai_usage u
    left join commerce.accounts o on o.id = u.owner_account_id
    left join commerce.stores s on s.id = u.store_id
    where u.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' - make_interval(days => ${Math.max(1, Math.round(days)) - 1})
      ${owned(ownedBy)}
      ${storeId ? sql`and u.store_id = ${storeId}::uuid` : sql``}
    group by u.owner_account_id, o.email, o.name, u.store_id, s.slug, s.name, u.source, u.provider, u.model, u.kind, u.feature
  `);
  return rows.map((r) => ({
    ownerId: r.owner_account_id ? String(r.owner_account_id) : null,
    ownerEmail: r.owner_email ? String(r.owner_email) : null,
    ownerName: r.owner_name ? String(r.owner_name) : null,
    storeId: r.store_id ? String(r.store_id) : null,
    storeSlug: r.store_slug ? String(r.store_slug) : null,
    storeName: r.store_name ? String(r.store_name) : null,
    source: r.source as AiSource,
    provider: String(r.provider),
    model: String(r.model),
    kind: r.kind as AiKind,
    feature: String(r.feature),
    requests: Number(r.requests),
    failed: Number(r.failed),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    characters: Number(r.characters),
    audioSeconds: Number(r.audio_seconds),
    images: Number(r.images),
    estimatedRequests: Number(r.estimated_requests),
  }));
}

export type DailyUsage = { day: string; requests: number; tokens: number };

/** Requests and tokens per day over the period, for the chart. */
export async function usageByDay({ days, ownedBy = null, storeId = null }: UsageQuery): Promise<DailyUsage[]> {
  const rows = await db().execute<Row>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(sum(u.requests), 0)::bigint as requests,
      coalesce(sum(u.input_tokens + u.output_tokens), 0)::bigint as tokens
    from generate_series(
      date_trunc('day', now() at time zone 'utc') - make_interval(days => ${Math.max(1, Math.round(days)) - 1}),
      date_trunc('day', now() at time zone 'utc'),
      interval '1 day'
    ) as d(day)
    left join commerce.ai_usage u on date_trunc('day', u.created_at at time zone 'utc') = d.day
      ${owned(ownedBy)}
      ${storeId ? sql`and u.store_id = ${storeId}::uuid` : sql``}
    group by d.day order by d.day
  `);
  return rows.map((r) => ({ day: String(r.day), requests: Number(r.requests), tokens: Number(r.tokens) }));
}

/** The stores an account owns (not closed), by name: what an owner's usage report covers. */
export async function ownedStores(accountId: string): Promise<{ id: string; slug: string; name: string }[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.slug, s.name from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not s.is_template
    where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
    order by s.name
  `);
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), name: String(r.name) }));
}
