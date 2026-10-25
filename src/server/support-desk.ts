import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { can, type Access, type PermissionHolder } from "@/lib/permissions";
import { allowedWhenNotOpen } from "@/lib/store-closure";

import { getAccount, requirePlatformAdmin, type Account, type Membership } from "./auth";
import type { ChatSite } from "./chat-agent";
import { checkPermission, requirePermission } from "./permissions";

/**
 * A support desk (D216, `docs/support.md` 4.5): a store's, or Kaizen's (`storeId` null). Every reader and writer in
 * `src/server/support*.ts` takes one, and only this module makes one, each after its own check, so a desk in hand means the check
 * was made. A scan test fails for `as Desk` anywhere else.
 */

declare const deskBrand: unique symbol;
export type Desk = { readonly storeId: string | null; readonly [deskBrand]: true };

const make = (storeId: string | null): Desk => ({ storeId }) as Desk;

/**
 * The desk a visitor writes to: the site the chat route resolved (a store in one of its countries through `resolveShop()`, which
 * is a 404 for a store that is not open, or Kaizen's). The conversation's own token is checked by `visitorConversation()`.
 */
export function visitorDesk(site: ChatSite): Desk {
  return make(site.kind === "store" ? site.store.id : null);
}

/**
 * Kaizen's desk as an owner or a member of staff writes to it from the admin (D216, 2.8, step 11): the signed-in account (from
 * `getAccount()`, which verified the session) asks Kaizen; each of their conversations is found by `requester_id` alone
 * (`src/server/support-kaizen.ts`).
 */
export function requesterDesk(account: Account): Desk {
  void account;
  return make(null);
}

/**
 * The desk the AI manager's support tools read (D216, 5.5, step 14): a store's, after `runOwnerTool()` checked the member's
 * `support:read`, or Kaizen's, after `runPlatformTool()` checked a platform admin. Counts, titles and summaries only.
 */
export function managerDesk(storeId: string | null): Desk {
  return make(storeId);
}

/**
 * A store's desk the AI manager answers at (PSI AGT-01, `src/server/support-manager-tools.ts`), in the person's name, after
 * `runOwnerTool()` checked their `support:write` (or `support:read` for reading) by `TOOL_PERMISSIONS`; a reply waits for their yes.
 */
export function managerStaffDesk(account: Account, store: { id: string; slug: string; name: string; status: string }, who: PermissionHolder): StaffDesk {
  return {
    desk: make(store.id),
    store: { id: store.id, slug: store.slug, name: store.name },
    account,
    canWrite: can(who, "support:write") && (store.status === "active" || allowedWhenNotOpen("support:write")),
    holder: who,
  };
}

/** A desk for the platform's own jobs (ending idle conversations, retention, erasure), which act on every store's data by design. */
export function systemDesk(storeId: string | null): Desk {
  return make(storeId);
}

// Staff ----------------------------------------------------------------------------------------------------------------------------

/** A desk a person works at, with what they may do there. */
export type StaffDesk = {
  desk: Desk;
  /** The store's address and name, or null for Kaizen's desk. */
  store: { id: string; slug: string; name: string } | null;
  account: Account;
  /** Answering, taking over and the rest (step 4); `support:write` in a store, a platform admin on Kaizen's. */
  canWrite: boolean;
  /** The person's role in the store, for what the silent partner may read for them (step 8); null on Kaizen's desk. */
  holder: PermissionHolder | null;
};

/**
 * A store's desk for a member whose guard the caller asked (`requirePermission(slug, "support:read")` or `checkPermission(...)` in the
 * page, route or action itself, which the permissions scan reads).
 */
export const memberDesk = (member: Membership): StaffDesk => fromMember(member);

const fromMember = (member: Membership): StaffDesk => ({
  desk: make(member.store.id),
  store: { id: member.store.id, slug: member.store.slug, name: member.store.name },
  account: member.account,
  canWrite: can(holder(member), "support:write") && (member.store.status === "active" || allowedWhenNotOpen("support:write")),
  holder: holder(member),
});

const holder = (member: Pick<Membership, "role" | "kind" | "permissions">) => ({ role: member.role, kind: member.kind, permissions: member.permissions });

/** A store's desk for a page: `support:read` or `support:write` (`requirePermission()`: a 404 for anyone else). */
export async function storeDesk(slug: string, access: Access): Promise<StaffDesk> {
  return fromMember(await requirePermission(slug, `support:${access}`));
}

/** A store's desk for a route or an action, or null. */
export async function checkStoreDesk(slug: string, access: Access): Promise<StaffDesk | null> {
  const member = await checkPermission(slug, `support:${access}`);
  return member ? fromMember(member) : null;
}

/** Kaizen's own desk, for a platform admin's page (a 404 for anyone else). */
export async function kaizenDesk(): Promise<StaffDesk> {
  const account = await requirePlatformAdmin();
  return { desk: make(null), store: null, account, canWrite: true, holder: null };
}

/** Kaizen's own desk for a route or an action, or null. */
export async function checkKaizenDesk(): Promise<StaffDesk | null> {
  const account = await getAccount();
  return account?.platformAdmin ? { desk: make(null), store: null, account, canWrite: true, holder: null } : null;
}

type Row = Record<string, unknown>;

/**
 * The desks of every store where the account may read support (`support:read` by its role there, in a store that is open or not,
 * never one the platform keeps for itself), for the owner's combined inbox (2.8), by store name. Each says whether the account
 * may answer there; actions check `support:write` per store again (`checkStoreDesk()`).
 */
export async function ownerDesks(account: Account): Promise<StaffDesk[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.status, m.role, m.kind, m.role_id, r.permissions as role_permissions
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
      and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.account_id = ${account.id}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
    order by lower(s.name), s.slug
  `);
  const desks: StaffDesk[] = [];
  for (const row of rows) {
    const who = {
      role: String(row.role) as Membership["role"],
      kind: row.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const),
      permissions: row.role_id ? ((row.role_permissions ?? []) as unknown[]).map(String) : null,
    };
    const open = row.status === "active";
    if (!can(who, "support:read")) continue;
    desks.push({
      desk: make(String(row.id)),
      store: { id: String(row.id), slug: String(row.slug), name: String(row.name) },
      account,
      canWrite: open && can(who, "support:write"),
      holder: who,
    });
  }
  return desks;
}
