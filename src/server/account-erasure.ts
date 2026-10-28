import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit, type Account } from "./auth";
import { log } from "./log";
import { removeAvatarFiles } from "./media";
import { forgetAlertRecipientIn } from "./staff-alerts";
import { adminAuth } from "./supabase-admin";

type Row = Record<string, unknown>;

/**
 * An owner's or a staff member's own account erased (wave 10 unit P, D377; PSI REG-03): the platform is the controller of these people's
 * data, so they need a way out as shoppers have one (D162). The account row stays, because a hundred and fifty tables name it as who did
 * something (the activity log, orders' and pages' authors, Work's entries, invoices); it is made anonymous instead: its email becomes an
 * address that is none, its name and picture go, its sign-in user is deleted and it is switched off, so every place that names it now
 * names nobody (the activity log is pseudonymised by this, never edited). What is only theirs is deleted: their memberships, the AI
 * manager's conversations, memories, notices, saved skills and follow-ups, their devices for push, their recovery codes, their links to
 * Kaizen Life and WordPress, their support inbox state and alert choices, and the emails Kaizena Flow sent them as staff; their
 * applications to open a store are emptied. A customer record with the same email in a store is a different subject (the store's
 * shopper) and is not touched.
 *
 * Refused, before anything changes, while the account is a platform admin (another admin takes that away first), the last owner of a store
 * that is not closed (close it, or make someone else an owner), an outside host with listings, or the holder of a domain that is not gone;
 * and only after a sign-in in the last ten minutes with the account's email typed again (the caller asks both). The one writer of this.
 */

export const ERASE_REFUSALS = ["not_found", "platform_admin", "last_owner", "host", "domains"] as const;
export type EraseRefusal = (typeof ERASE_REFUSALS)[number];

export type ErasePlan = { ok: true; stores: number; conversations: number; memories: number } | { ok: false; refusal: EraseRefusal; stores?: string[] };

/** The address an erased account keeps: unique, and a domain that can never receive mail (RFC 2606). */
export const erasedEmail = (accountId: string): string => `erased-${accountId}@erased.invalid`;

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Runner = Pick<Tx, "execute">;

/** What erasing would do, or why it cannot, read in the caller's transaction (or outside one for the preview). */
async function planIn(runner: Runner, accountId: string): Promise<ErasePlan> {
  const [account] = await runner.execute<Row>(sql`select platform_admin, disabled_at from commerce.accounts where id = ${accountId}::uuid`);
  if (!account || account.disabled_at) return { ok: false, refusal: "not_found" };
  if (account.platform_admin) return { ok: false, refusal: "platform_admin" };
  // Stores that are not closed whose only active owner is this account: a store needs an owner while it can sell or be reopened.
  const alone = await runner.execute<Row>(sql`
    select s.name from commerce.store_members m join commerce.stores s on s.id = m.store_id
    where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null and s.status <> 'closed'
      and not (s.is_template or s.starter)
      and not exists (
        select 1 from commerce.store_members o
        where o.store_id = m.store_id and o.account_id <> m.account_id and o.role = 'owner' and o.disabled_at is null
          and (o.expires_at is null or o.expires_at > now())
      )
    order by s.name
  `);
  if (alone.length > 0) return { ok: false, refusal: "last_owner", stores: alone.map((r) => String(r.name)) };
  const [f] = await runner.execute<Row>(sql`
    select
      exists (select 1 from commerce.hosts where account_id = ${accountId}::uuid and disabled_at is null) as host,
      exists (select 1 from commerce.domain_registrations where account_id = ${accountId}::uuid and status <> 'transferred_out') as domains,
      (select count(*)::int from commerce.store_members where account_id = ${accountId}::uuid) as stores,
      (select count(*)::int from commerce.assistant_conversations where account_id = ${accountId}::uuid) as conversations,
      (select count(*)::int from commerce.assistant_memories where account_id = ${accountId}::uuid) as memories
  `);
  if (f?.host) return { ok: false, refusal: "host" };
  if (f?.domains) return { ok: false, refusal: "domains" };
  return { ok: true, stores: Number(f?.stores ?? 0), conversations: Number(f?.conversations ?? 0), memories: Number(f?.memories ?? 0) };
}

/** The preview the account page shows before the person confirms: what goes, or why it cannot. Changes nothing. */
export const erasePreview = (account: Pick<Account, "id">): Promise<ErasePlan> => planIn(db(), account.id);

/**
 * Erases the account (the caller has checked a recent sign-in and the email typed). One transaction under the account's row lock: the plan
 * is read again there, so a refusal found then changes nothing. Afterwards, outside it, the sign-in user and the picture's file are
 * removed; a failure there is logged and changes nothing the person sees (the account no longer points at the user and is switched off,
 * so the user cannot sign in to it).
 */
export async function eraseOwnAccount(account: Pick<Account, "id">, deps: { deleteAuthUser?: (id: string) => Promise<void> } = {}): Promise<ErasePlan> {
  const done = await db().transaction(async (tx) => {
    const [locked] = await tx.execute<Row>(sql`select email, auth_user_id, avatar_path from commerce.accounts where id = ${account.id}::uuid for update`);
    if (!locked) return { plan: { ok: false, refusal: "not_found" } as ErasePlan, authUserId: null, avatar: null };
    const plan = await planIn(tx, account.id);
    if (!plan.ok) return { plan, authUserId: null, avatar: null };
    const email = String(locked.email).toLowerCase();
    const id = account.id;
    // What is only theirs.
    await tx.execute(sql`delete from commerce.store_members where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.assistant_conversations where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.assistant_memories where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.assistant_notices where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.assistant_skills where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.assistant_follow_ups where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.push_subscriptions where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.account_recovery_codes where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.kaizen_life_links where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.wordpress_connections where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.support_agents where account_id = ${id}::uuid`);
    await tx.execute(sql`delete from commerce.support_reads where account_id = ${id}::uuid`);
    await forgetAlertRecipientIn(tx, id);
    // The emails Kaizena Flow sent them as staff or about their own sign-in (a shopper's emails are their store's, D162).
    await tx.execute(sql`
      update commerce.email_messages set to_address = '[removed]', subject = '[removed]', html = '', text = ''
      where lower(to_address) = ${email} and (kind like 'staff.%' or kind like 'security.%' or kind like 'platform.%' or kind like 'assistant.%'
        or kind like 'autopilot.%' or kind like 'usage.%' or kind like 'privacy.%' or kind like 'data_job.%' or kind like 'domain.%'
        or kind like 'referral.%' or kind like 'plan_reminder%' or kind like 'store.%' or kind like 'work.%' or kind like 'support.waiting%')
    `);
    // Their applications to open a store: the row stays for the store it made, the person goes.
    await tx.execute(sql`
      update commerce.access_requests set email = ${erasedEmail(id)}, name = '', message = '' where lower(email) = ${email}
    `);
    await tx.execute(sql`
      update commerce.accounts
         set email = ${erasedEmail(id)}, name = null, avatar_path = null, auth_user_id = null, platform_admin = false,
             assistant_learns = false, two_step_since = null, two_step_reenrol_at = null, disabled_at = now()
       where id = ${id}::uuid
    `);
    return { plan, authUserId: locked.auth_user_id ? String(locked.auth_user_id) : null, avatar: locked.avatar_path ? String(locked.avatar_path) : null };
  });
  if (!done.plan.ok) return done.plan;
  await audit(account.id, null, "account.erased", { ...done.plan }, { area: "account", target: { type: "account", id: account.id } }).catch((error) =>
    log("error", "account_erasure.audit_failed", { account: account.id }, error),
  );
  if (done.authUserId) {
    try {
      if (deps.deleteAuthUser) await deps.deleteAuthUser(done.authUserId);
      else {
        const client = adminAuth();
        if (!client.ok) throw new Error(client.problem);
        const { error } = await client.admin.deleteUser(done.authUserId);
        if (error) throw error;
      }
    } catch (error) {
      log("error", "account_erasure.auth_user_left", { account: account.id }, error);
    }
  }
  if (done.avatar) await removeAvatarFiles([done.avatar]).catch((error) => log("error", "account_erasure.avatar_left", { account: account.id }, error));
  return done.plan;
}
