import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { slugProblem } from "@/lib/slug";
import { emailSignInLink } from "@/lib/supabase/mailer";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

export type AccessRequestInput = {
  name: string;
  email: string;
  storeName: string;
  message: string;
};

/**
 * Records a request to join the beta. A second request from an email that
 * already has one pending is quietly merged, so the form never reveals who
 * has asked before.
 */
export async function createAccessRequest(input: AccessRequestInput): Promise<void> {
  await db().execute(sql`
    insert into commerce.access_requests (email, name, store_name, message)
    values (${input.email}, ${input.name}, ${input.storeName}, ${input.message})
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
};

/** Pending requests first (oldest first), then the 20 latest decisions. */
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const rows = await db().execute<Row>(sql`
    (select r.*, s.slug as store_slug, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
     where r.status = 'pending'
     order by r.created_at)
    union all
    (select r.*, s.slug as store_slug, exists (
       select 1 from commerce.accounts a where lower(a.email) = lower(r.email)
     ) as has_account
     from commerce.access_requests r
     left join commerce.stores s on s.id = r.store_id
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
 * Approves a request: account, store copied from the template, and the
 * decision, in one database transaction; then emails a sign-in link.
 */
export async function approveAccessRequest(
  admin: Account,
  requestId: string,
  slug: string,
  storeName: string,
  origin: string,
): Promise<ApproveResult> {
  const problem = slugProblem(slug);
  if (problem) return { ok: false, problems: [`Store address: ${problem}`] };
  if (!storeName.trim()) return { ok: false, problems: ["Enter a store name."] };

  let email: string;
  try {
    const [row] = await db().execute<Row>(sql`
      select commerce.approve_access_request(
        ${requestId}::uuid, ${slug}, ${storeName.trim()}, ${admin.id}::uuid
      ) as store_id,
      (select email from commerce.access_requests where id = ${requestId}::uuid) as email
    `);
    email = String(row.email);
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }

  return { ok: true, slug, email, invited: await emailSignInLink(email, origin) };
}

function approvalProblem(error: unknown, slug: string): string {
  const text = describe(error);
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
 * An owner creates another store: a copy of the demo template, with them as
 * owner, like an approved request. Only people who already own a store (or
 * run the platform) can, so the beta stays invite-only.
 */
export async function createStoreForOwner(account: Account, name: string, slug: string): Promise<CreateStoreResult> {
  const problems: string[] = [];
  if (!name.trim()) problems.push("Enter a store name.");
  const problem = slugProblem(slug);
  if (problem) problems.push(`Store address: ${problem}`);
  if (problems.length > 0) return { ok: false, problems };

  const [owned] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${account.id}::uuid and m.role = 'owner' and m.disabled_at is null
      and s.status <> 'closed' and not s.is_template
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
        (select id from commerce.stores where is_template), ${slug}, ${name.trim()}, ${account.id}::uuid
      )
    `);
  } catch (error) {
    return { ok: false, problems: [approvalProblem(error, slug)] };
  }
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
  await audit(account.id, store ? String(store.id) : null, "store.created_by_owner", { slug, name: name.trim() });
  return { ok: true, slug };
}
