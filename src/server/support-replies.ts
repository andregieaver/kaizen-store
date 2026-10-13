import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { REPLIES_MAX, fillPlaceholders, firstName, type SavedReply } from "@/lib/support-replies";
import { replyInput } from "@/lib/support-replies-schema";

import { audit } from "./auth";
import { agentIdentity } from "./support";
import type { StaffDesk } from "./support-desk";

type Row = Record<string, unknown>;

/**
 * A desk's saved replies (D216, `docs/support.md` 2.4, step 13): written on the Saved replies page of the store's desk or Kaizen's,
 * read by everyone who reads the desk, written by those who may answer there (`support:write`; platform admins on Kaizen's). The
 * composer's `/` picker gets them filled in for a conversation (`repliesFor()`); nothing here sends anything.
 */

const deskIs = (staff: StaffDesk) => (staff.desk.storeId ? sql`store_id = ${staff.desk.storeId}::uuid` : sql`store_id is null`);

const toReply = (r: Row): SavedReply => ({ id: String(r.id), title: String(r.title), body: String(r.body), shortcut: String(r.shortcut ?? ""), locale: r.locale ? String(r.locale) : null });

/** The desk's saved replies, by shortcut. */
export async function listReplies(staff: StaffDesk): Promise<SavedReply[]> {
  const rows = await db().execute<Row>(sql`
    select id, title, body, shortcut, locale from commerce.support_replies where ${deskIs(staff)} order by shortcut nulls last, lower(title) limit ${REPLIES_MAX}
  `);
  return rows.map(toReply);
}

export type ReplySave = { ok: true; id: string } | { ok: false; problems: string[] };

/** Adds a saved reply, or changes one of the desk's (`id`). A shortcut is the desk's own: another reply's is refused in words. */
export async function saveReply(staff: StaffDesk, raw: unknown): Promise<ReplySave> {
  if (!staff.canWrite) return { ok: false, problems: ["You can read this desk's saved replies but not change them."] };
  const parsed = replyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => issue.message) };
  const input = parsed.data;
  const [taken] = await db().execute<Row>(sql`
    select id from commerce.support_replies where ${deskIs(staff)} and shortcut = ${input.shortcut} and ${input.id ? sql`id <> ${input.id}::uuid` : sql`true`}
  `);
  if (taken) return { ok: false, problems: [`Another saved reply already has the shortcut /${input.shortcut}.`] };
  let id = input.id;
  if (id) {
    const [row] = await db().execute<Row>(sql`
      update commerce.support_replies set title = ${input.title}, body = ${input.body}, shortcut = ${input.shortcut}, locale = ${input.locale}, updated_at = now()
      where id = ${id}::uuid and ${deskIs(staff)} returning id
    `);
    if (!row) return { ok: false, problems: ["That saved reply is gone."] };
  } else {
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.support_replies where ${deskIs(staff)}`);
    if (Number(count?.n ?? 0) >= REPLIES_MAX) return { ok: false, problems: [`A desk keeps at most ${REPLIES_MAX} saved replies.`] };
    const [row] = await db().execute<Row>(sql`
      insert into commerce.support_replies (store_id, title, body, shortcut, locale, created_by)
      values (${staff.desk.storeId}::uuid, ${input.title}, ${input.body}, ${input.shortcut}, ${input.locale}, ${staff.account.id}::uuid) returning id
    `);
    id = String(row.id);
  }
  await audit(staff.account.id, staff.desk.storeId, input.id ? "support.reply_changed" : "support.reply_added", { shortcut: input.shortcut }, { target: { type: "support_reply", id } });
  return { ok: true, id };
}

/** Deletes one of the desk's saved replies. */
export async function deleteReply(staff: StaffDesk, id: string): Promise<boolean> {
  if (!staff.canWrite || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const [row] = await db().execute<Row>(sql`delete from commerce.support_replies where id = ${id}::uuid and ${deskIs(staff)} returning shortcut`);
  if (!row) return false;
  await audit(staff.account.id, staff.desk.storeId, "support.reply_deleted", { shortcut: row.shortcut }, { target: { type: "support_reply", id } });
  return true;
}

/**
 * The desk's saved replies filled in for a conversation of the desk, for the person who writes: the customer's first name (from
 * their account or the name they gave, never an email address), the person's own name as customers see it, and the store's name.
 * Null when the conversation is not the desk's.
 */
export async function repliesFor(staff: StaffDesk, conversationId: string): Promise<{ replies: SavedReply[]; locale: string } | null> {
  const [c] = await db().execute<Row>(sql`
    select c.locale, s.name as store_name, coalesce(nullif(cu.name, ''), nullif(c.contact_name, ''), nullif(ra.name, '')) as who_name
    from commerce.support_conversations c
    left join commerce.stores s on s.id = c.store_id
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    left join commerce.accounts ra on ra.id = c.requester_id
    where c.id = ${conversationId}::uuid and ${staff.desk.storeId ? sql`c.store_id = ${staff.desk.storeId}::uuid` : sql`c.store_id is null`} and c.anonymised_at is null
  `);
  if (!c) return null;
  const [replies, identity] = await Promise.all([listReplies(staff), agentIdentity(staff.desk, staff.account.id)]);
  const facts = {
    customerFirstName: firstName(c.who_name ? String(c.who_name) : null),
    agentFirstName: firstName(identity.name),
    store: c.store_name ? String(c.store_name) : "Kaizen",
  };
  return { locale: String(c.locale), replies: replies.map((reply) => ({ ...reply, body: fillPlaceholders(reply.body, facts) })) };
}
