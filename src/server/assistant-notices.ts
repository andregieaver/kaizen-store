import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { NOTICE_DAYS, NOTICE_KINDS, type NoticeKind } from "@/lib/assistant-notices";

import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * What the AI manager finished or waits on while the person was away (wave 8 unit F, D350): written here and nowhere else, once per account,
 * kind and reference, by the jobs that finish work (`runPageJobs()`, `runFollowUps()`, the autopilot's loop, the gated calls it keeps for a
 * yes in the background, the autopilot's reports). The emails those jobs send are unchanged; a notice is the same news in the admin. A notice
 * holds an admin path of the person's own place and a few facts (a title, a summary), never a customer's details.
 */

export type Notice = {
  id: string;
  kind: NoticeKind;
  storeId: string | null;
  /** The store's name, or null for Kaizena Flow's own AI manager. */
  place: string | null;
  facts: Record<string, string>;
  href: string;
  read: boolean;
  createdAt: string;
};

/** The admin path of a place's page: `/admin/{store}/{path}`, or `/admin/platform/{path}` for Kaizena Flow's own. */
const placePath = (storeId: string | null, path: string) =>
  storeId
    ? sql`'/admin/' || (select s.slug from commerce.stores s where s.id = ${storeId}::uuid) || ${`/${path}`}`
    : sql`${`/admin/platform/${path}`}`;

/** Facts kept as short strings only: a notice is words, never data to act on. */
function cleanFacts(facts: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (typeof value === "string" && value.trim()) kept[key] = value.replace(/\s+/g, " ").trim().slice(0, 200);
    else if (typeof value === "number" && Number.isFinite(value)) kept[key] = String(value);
  }
  return kept;
}

/**
 * Keeps a notice for a person, once per kind and reference (a second call is a no-op). `path` is the page it opens under the place's admin
 * (`assistant?c={conversation}`, `pages/{id}`). Never throws: the work it tells of is done whether or not it is told.
 */
export async function addNotice(input: {
  accountId: string;
  storeId: string | null;
  /** What it is (called `notice`, so no one takes it for an email's kind). */
  notice: NoticeKind;
  ref: string;
  path: string;
  facts?: Record<string, unknown>;
}): Promise<void> {
  if (!NOTICE_KINDS.includes(input.notice)) return;
  try {
    await db().execute(sql`
      insert into commerce.assistant_notices (account_id, store_id, kind, ref, facts, href)
      select ${input.accountId}::uuid, ${input.storeId}::uuid, ${input.notice}, ${input.ref.slice(0, 200)},
        ${JSON.stringify(cleanFacts(input.facts ?? {}))}::jsonb, ${placePath(input.storeId, input.path.replace(/^\/+/, ""))}
      where ${input.storeId}::uuid is null or exists (select 1 from commerce.stores s where s.id = ${input.storeId}::uuid)
      on conflict (account_id, kind, ref) do nothing
    `);
  } catch (error) {
    log("error", "assistant_notice.not_kept", { notice: input.notice, store: input.storeId }, error);
  }
}

/** A gated call kept for the person's yes while they were not in the conversation (a follow-up, the autopilot, an event, Kaizen Life). */
export async function noticeApproval(
  approval: { id: string; summary: string; status?: string },
  conversationId: string,
  accountId: string,
  storeId: string | null,
): Promise<void> {
  if (approval.status && approval.status !== "pending") return;
  await addNotice({
    accountId,
    storeId,
    notice: "approval_waiting",
    ref: approval.id,
    path: `assistant?c=${conversationId}`,
    facts: { summary: approval.summary },
  });
}

/**
 * The autopilot's news the loop leaves behind (D309): a step that asks the owner a question, and a plan that finished. Swept after each run
 * of the loop rather than written at each of its many exits, so a question asked by a failed step and one asked by a question step are told
 * alike; the unique key keeps each told once.
 */
export async function noticeAutopilot(): Promise<number> {
  try {
    const asked = await db().execute(sql`
      insert into commerce.assistant_notices (account_id, store_id, kind, ref, facts, href)
      select p.account_id, p.store_id, 'plan_question', st.id::text,
        jsonb_build_object('plan', left(p.title, 200), 'step', left(st.title, 200)),
        coalesce('/admin/' || s.slug, '/admin/platform') || '/assistant/autopilot'
      from commerce.assistant_plan_steps st
      join commerce.assistant_plans p on p.id = st.plan_id
      left join commerce.stores s on s.id = p.store_id
      where st.status = 'asking'
      on conflict (account_id, kind, ref) do nothing
      returning id
    `);
    const done = await db().execute(sql`
      insert into commerce.assistant_notices (account_id, store_id, kind, ref, facts, href)
      select p.account_id, p.store_id, 'plan_done', p.id::text, jsonb_build_object('plan', left(p.title, 200)),
        coalesce('/admin/' || s.slug, '/admin/platform') || '/assistant/autopilot'
      from commerce.assistant_plans p
      left join commerce.stores s on s.id = p.store_id
      where p.status = 'done' and p.finished_at > now() - interval '1 day'
      on conflict (account_id, kind, ref) do nothing
      returning id
    `);
    return asked.length + done.length;
  } catch (error) {
    log("error", "assistant_notice.autopilot_failed", {}, error);
    return 0;
  }
}

const NOTICE = z.object({
  id: col.uuid,
  kind: col.text,
  store_id: col.uuid.nullable(),
  place: col.textOrNull,
  facts: z.unknown(),
  href: col.text,
  read: col.bool,
  created_at: col.timestamp,
});

/** Which place's notices: a store's by id, Kaizena Flow's own (`null`), or every place the person has (`"all"`). */
export type NoticePlace = string | null | "all";

const placeWhere = (place: NoticePlace) =>
  place === "all" ? sql`true` : place === null ? sql`n.store_id is null` : sql`n.store_id = ${place}::uuid`;

/** A person's notices, newest first, with how many are unread. */
export async function listNotices(accountId: string, place: NoticePlace, limit = 30): Promise<{ unread: number; items: Notice[] }> {
  const rows = await typedRows(
    NOTICE,
    sql`
      select n.id, n.kind, n.store_id, s.name as place, n.facts, n.href, n.read_at is not null as read, n.created_at
      from commerce.assistant_notices n left join commerce.stores s on s.id = n.store_id
      where n.account_id = ${accountId}::uuid and ${placeWhere(place)}
      order by n.created_at desc, n.id
      limit ${Math.min(Math.max(1, limit), 100)}
    `,
  );
  return {
    unread: await unreadNotices(accountId, place),
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind as NoticeKind,
      storeId: row.store_id,
      place: row.place,
      facts: cleanFacts((row.facts ?? {}) as Record<string, unknown>),
      href: row.href,
      read: row.read,
      createdAt: row.created_at,
    })),
  };
}

/** How many of a person's notices are unread, in a place or everywhere. */
export async function unreadNotices(accountId: string, place: NoticePlace): Promise<number> {
  const [row] = await typedRows(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.assistant_notices n where n.account_id = ${accountId}::uuid and n.read_at is null and ${placeWhere(place)}`,
  );
  return row?.n ?? 0;
}

/** Marks a person's own notices read: the ones given, or every one in the place. Returns how many changed. */
export async function markNoticesRead(accountId: string, place: NoticePlace, ids: string[] | "all"): Promise<number> {
  const only = ids === "all" ? sql`true` : ids.length === 0 ? sql`false` : sql`n.id = any(${`{${ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).join(",")}}`}::uuid[])`;
  const rows = await db().execute(sql`
    update commerce.assistant_notices n set read_at = now()
    where n.account_id = ${accountId}::uuid and n.read_at is null and ${placeWhere(place)} and ${only}
    returning n.id
  `);
  return rows.length;
}

/** Notices are kept `NOTICE_DAYS` (the daily job). */
export async function pruneNotices(): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.assistant_notices where created_at < now() - make_interval(days => ${NOTICE_DAYS}) returning id
  `);
  return rows.length;
}
