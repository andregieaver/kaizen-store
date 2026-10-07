import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { slugProblem } from "@/lib/slug";
import { emailSignInLink } from "@/lib/supabase/mailer";

import { starterRefusal } from "@/lib/store-starters";

import { audit, type Account } from "./auth";
import { notifyReferralOpened, usableReferralCode } from "./referrals";

type Row = Record<string, unknown>;

export type AccessRequestInput = {
  name: string;
  email: string;
  storeName: string;
  message: string;
  /** The referral code the sign-up came with (D131): from the link's address or form, else the cookie kept after consent. */
  referralCode?: string | null;
  /** The store template chosen (D175): a published starter's id, else nothing (the Standard store). */
  starterId?: string | null;
};

/**
 * Records a request to join the beta. A second request from an email that
 * already has one pending is quietly merged, so the form never reveals who
 * has asked before. A referral code (D131) is kept with the request when it is
 * a real one of a referrer who is not blocked; any other is dropped without a
 * word, so the form reveals nothing about codes either. Approving the request
 * makes the referral, in SQL. A store template (D175) is kept only when it is a
 * published one; any other value is dropped the same way.
 */
export async function createAccessRequest(input: AccessRequestInput): Promise<void> {
  const referralCode = await usableReferralCode(input.referralCode);
  await db().execute(sql`
    insert into commerce.access_requests (email, name, store_name, message, referral_code, starter_id)
    values (${input.email}, ${input.name}, ${input.storeName}, ${input.message}, ${referralCode},
      (select st.id from commerce.store_starters st where st.id = ${input.starterId ?? null}::uuid and st.published))
    on conflict ((lower(email))) where status = 'pending' do nothing
  `);
}

export type AccessRequest = {
  id: string;
  email: string;
  name: string;
  storeName: string;
  message: string;
  status: "pending" | "approved" | "declined";
  createdAt: string;
  decidedAt: string | null;
  storeSlug: string | null;
  /** True when this email already has an account (e.g. staff in a store). */
  hasAccount: boolean;
  /** The store template the requester chose (D175), or null for the Standard store. */
  starterId: string | null;
  starterTitle: string | null;
};

/** Pending requests first (oldest first), then the 20 latest decisions. */
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const rows = await db().execute<Row>(sql`
    (select r.*, s.slug as store_slug, st.title as starter_title, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
     left join commerce.store_starters st on st.id = r.starter_id
     where r.status = 'pending'
     order by r.created_at)
    union all
    (select r.*, s.slug as store_slug, st.title as starter_title, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
     left join commerce.store_starters st on st.id = r.starter_id
     where r.status <> 'pending'
     order by r.decided_at desc
     limit 20)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    storeName: String(row.store_name),
    message: String(row.message ?? ""),
    status: row.status as AccessRequest["status"],
    createdAt: new Date(String(row.created_at)).toISOString(),
    decidedAt: row.decided_at ? new Date(String(row.decided_at)).toISOString() : null,
    storeSlug: row.store_slug ? String(row.store_slug) : null,
    hasAccount: Boolean(row.has_account),
    starterId: row.starter_id ? String(row.starter_id) : null,
    starterTitle: row.starter_title ? String(row.starter_title) : null,
  }));
}

export async function countPendingRequests(): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.access_requests where status = 'pending'
  `);
  return Number(row?.n ?? 0);
}

export async function isSlugTaken(slug: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as taken from commerce.stores where slug = ${slug}
  `);
  return Boolean(row);
}

export type ApproveResult =
  | { ok: true; slug: string; email: string; invited: boolean }
  | { ok: false; problems: string[] };

/**
 * Approves a request: account, store copied from the store template chosen
 * (D175: the requester's, or the one the admin changed it to; null is the
 * Standard store) and the decision, in one database transaction; then emails
 * a sign-in link. `commerce.starter_source()` refuses a template that is not
 * published, so nothing is created then.
 */
export async function approveAccessRequest(
  admin: Account,
  requestId: string,
  slug: string,
  storeName: string,
  origin: string,
  /** The store template to copy: an id, null for the Standard store, or left out to keep the requester's choice. */
  starterId?: string | null,
): Promise<ApproveResult> {
  const problem = slugProblem(slug);
  if (problem) return { ok: false, problems: [`Store address: ${problem}`] };
  if (!storeName.trim()) return { ok: false, problems: ["Enter a store name."] };

  let email: string;
  let storeId: string;
  try {
    const row = await db().transaction(async (tx) => {
      if (starterId !== undefined) {
        // An id that is not a published template is refused here in plain words (store_starters.not_offered), before anything is kept.
        if (starterId) await tx.execute(sql`select commerce.starter_source(${starterId}::uuid)`);
        await tx.execute(sql`
          update commerce.access_requests set starter_id = ${starterId}::uuid
           where id = ${requestId}::uuid and status = 'pending' and starter_id is distinct from ${starterId}::uuid
        `);
      }
      const [approved] = await tx.execute<Row>(sql`
        select commerce.approve_access_request(
          ${requestId}::uuid, ${slug}, ${storeName.trim()}, ${admin.id}::uuid
        ) as store_id,
        (select email from commerce.access_requests where id = ${requestId}::uuid) as email
      `);
      return approved;
    });
    email = String(row.email);
    storeId = String(row.store_id);
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }
  // A store that came through a referral (D131, made by the approval itself): its referrer hears it is open. Best effort.
  await notifyReferralOpened(storeId).catch(() => null);

  return { ok: true, slug, email, invited: await emailSignInLink(email, origin) };
}

function approvalProblem(error: unknown, slug: string): string {
  const text = describe(error);
  const starter = starterRefusal(text);
  if (starter) return starter;
  if (text.includes("stores_slug_unique")) return `The address ${slug} is taken. Choose another.`;
  if (text.includes("already")) return "This request has already been decided.";
  if (text.includes("disabled")) return "That person's account is disabled.";
  if (text.includes("template")) return "There is no template store to copy.";
  return "The store could not be created. Nothing was changed; try again.";
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
  }
  return parts.join(" ");
}

export async function declineAccessRequest(admin: Account, requestId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    update commerce.access_requests
       set status = 'declined', decided_by = ${admin.id}::uuid, decided_at = now()
     where id = ${requestId}::uuid and status = 'pending'
    returning email
  `);
  if (row) await audit(admin.id, null, "platform.access_declined", { email: String(row.email) });
}

/** How many stores one person may own; platform admins have no limit. */
export const MAX_STORES_PER_OWNER = 10;

export type CreateStoreResult = { ok: true; slug: string } | { ok: false; problems: string[] };

/**
 * An owner creates another store: a copy of the store template chosen (D175:
 * a published starter's id) or of the demo template (null, the Standard
 * store), with them as owner, like an approved request. The source is decided
 * by `commerce.starter_source()`, so no other store can be passed. Only people
 * who already own a store (or run the platform) can, so the beta stays
 * invite-only.
 */
export async function createStoreForOwner(account: Account, name: string, slug: string, starterId: string | null = null): Promise<CreateStoreResult> {
  const problems: string[] = [];
  if (!name.trim()) problems.push("Enter a store name.");
  const problem = slugProblem(slug);
  if (problem) problems.push(`Store address: ${problem}`);
  if (problems.length > 0) return { ok: false, problems };

  const [owned] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
      and s.status <> 'closed' and not (s.is_template or s.starter)
  `);
  const count = Number(owned?.n ?? 0);
  if (!account.platformAdmin && count === 0) {
    return { ok: false, problems: ["Only store owners can create more stores. Ask for a store at /sign-up."] };
  }
  if (!account.platformAdmin && count >= MAX_STORES_PER_OWNER) {
    return { ok: false, problems: [`You can own up to ${MAX_STORES_PER_OWNER} stores. Contact Kaizen for more.`] };
  }
  if (await isSlugTaken(slug)) return { ok: false, problems: [`The address ${slug} is taken. Choose another.`] };

  try {
    await db().execute(sql`
      select commerce.clone_store(
        commerce.starter_source(${starterId}::uuid), ${slug}, ${name.trim()}, ${account.id}::uuid
      )
    `);
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
  await audit(account.id, store ? String(store.id) : null, "store.created_by_owner", { slug, name: name.trim(), starter: starterId });
  return { ok: true, slug };
}
