import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isAutoArchiveDays } from "@/lib/order-archive";
import { DRAFT_VALID_DAYS_DEFAULT, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN } from "@/lib/order-limits";
import { ORDER_AUDIT_ACTIONS } from "@/lib/order-ops-events";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * The store's order settings (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.3): gift messages (off), automatic archiving (off), how long a draft's pay link is
 * valid, and whether staff other than the owner may record a payment taken outside Kaizen. One row a store, made when first written (a store that never changed
 * anything has none and reads the defaults). Read per request, never in a `'use cache'` function: gift messages are asked on the cart page.
 */
export type OrderSettings = {
  giftMessages: boolean;
  /** Null: no automatic archiving. */
  autoArchiveDays: number | null;
  draftValidDays: number;
  staffMarkPaid: boolean;
};

export const DEFAULT_ORDER_SETTINGS: OrderSettings = {
  giftMessages: false,
  autoArchiveDays: null,
  draftValidDays: DRAFT_VALID_DAYS_DEFAULT,
  staffMarkPaid: false,
};

export async function getOrderSettings(storeId: string): Promise<OrderSettings> {
  const [row] = await db().execute<Row>(sql`
    select gift_messages, auto_archive_days, draft_valid_days, staff_mark_paid
    from commerce.order_settings where store_id = ${storeId}::uuid
  `);
  if (!row) return DEFAULT_ORDER_SETTINGS;
  return {
    giftMessages: Boolean(row.gift_messages),
    autoArchiveDays: row.auto_archive_days === null ? null : Number(row.auto_archive_days),
    draftValidDays: Number(row.draft_valid_days),
    staffMarkPaid: Boolean(row.staff_mark_paid),
  };
}

export type OrderSettingsInput = Partial<OrderSettings>;
export type SaveSettingsResult = { ok: true; settings: OrderSettings } | { ok: false; problem: string };

/** What staff read when a setting is refused. */
export const SETTINGS_PROBLEMS = {
  archive_days: "Automatic archiving is off, or after 14 to 365 days.",
  valid_days: `A pay link is valid for ${DRAFT_VALID_DAYS_MIN} to ${DRAFT_VALID_DAYS_MAX} days.`,
  owner_only: "Only the owner can change whether staff may record payments taken outside Kaizen.",
} as const;

/**
 * Saves the settings named in `input` (the others keep their value). The action layer needs `settings:write`; `staffMarkPaid` is the owner's alone, checked
 * here too (a request that names it from anyone else is refused whole, not silently dropped). Writes one audit entry that names the settings changed, never a value that is a person's.
 */
export async function saveOrderSettings(member: Pick<Membership, "account" | "store" | "role" | "kind" | "permissions">, input: OrderSettingsInput): Promise<SaveSettingsResult> {
  const before = await getOrderSettings(member.store.id);
  if (input.staffMarkPaid !== undefined && input.staffMarkPaid !== before.staffMarkPaid && !memberCan(member, "owner")) {
    return { ok: false, problem: SETTINGS_PROBLEMS.owner_only };
  }
  if (input.autoArchiveDays !== undefined && input.autoArchiveDays !== null && !isAutoArchiveDays(input.autoArchiveDays)) {
    return { ok: false, problem: SETTINGS_PROBLEMS.archive_days };
  }
  if (input.draftValidDays !== undefined && !(Number.isInteger(input.draftValidDays) && input.draftValidDays >= DRAFT_VALID_DAYS_MIN && input.draftValidDays <= DRAFT_VALID_DAYS_MAX)) {
    return { ok: false, problem: SETTINGS_PROBLEMS.valid_days };
  }
  const next: OrderSettings = {
    giftMessages: input.giftMessages ?? before.giftMessages,
    autoArchiveDays: input.autoArchiveDays === undefined ? before.autoArchiveDays : input.autoArchiveDays,
    draftValidDays: input.draftValidDays ?? before.draftValidDays,
    staffMarkPaid: input.staffMarkPaid ?? before.staffMarkPaid,
  };
  await db().execute(sql`
    insert into commerce.order_settings (store_id, gift_messages, auto_archive_days, draft_valid_days, staff_mark_paid)
    values (${member.store.id}::uuid, ${next.giftMessages}, ${next.autoArchiveDays}, ${next.draftValidDays}, ${next.staffMarkPaid})
    on conflict (store_id) do update set gift_messages = excluded.gift_messages, auto_archive_days = excluded.auto_archive_days,
      draft_valid_days = excluded.draft_valid_days, staff_mark_paid = excluded.staff_mark_paid, updated_at = now()
  `);
  const changed = (Object.keys(next) as (keyof OrderSettings)[]).filter((key) => next[key] !== before[key]);
  if (changed.length > 0) await audit(member.account.id, member.store.id, ORDER_AUDIT_ACTIONS.settingsChanged, { changed });
  return { ok: true, settings: next };
}

/** Whether this member may record a payment taken outside Kaizen (a draft paid outside, a refund of one): the owner always, others when the store allows it. */
export async function mayRecordOutsidePayment(member: Pick<Membership, "role" | "kind" | "permissions" | "store">): Promise<boolean> {
  if (memberCan(member, "owner")) return true;
  if (!memberCan(member, "orders:write")) return false;
  return (await getOrderSettings(member.store.id)).staffMarkPaid;
}

/**
 * The same rule asked by account id, for code that has no request (a refund made from a return, the AI manager): the account's own membership of the store is read here, as
 * the session reads it (a disabled member or an expired collaborator is nobody). Never true for no account.
 */
export async function accountMayRecordOutside(storeId: string, accountId: string | null): Promise<boolean> {
  if (!accountId) return false;
  const [row] = await db().execute<Row>(sql`
    select m.role, m.kind, m.role_id, r.permissions, s.status
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
    where m.store_id = ${storeId}::uuid and m.account_id = ${accountId}::uuid
      and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
  `);
  if (!row) return false;
  return mayRecordOutsidePayment({
    role: row.role as Membership["role"],
    kind: row.kind === "collaborator" ? "collaborator" : "staff",
    permissions: row.role_id ? ((row.permissions ?? []) as string[]).map(String) : null,
    store: { id: storeId, status: String(row.status) } as Membership["store"],
  });
}
