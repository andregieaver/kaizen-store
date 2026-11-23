import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PLATFORM_TIME_ZONE } from "@/lib/dates";
import { isBot } from "@/lib/experiments";

import { wantsPrivacy } from "./analytics-visits";
import { owned } from "./owned";
import { col, typedRows } from "./typed-rows";

/**
 * How often each saved form is seen on the site (email plan M4.3, a popup's own report): `recordFormSeen()` is the only writer of
 * `commerce.form_view_counts`, one counter per form and day in its store's time zone, nothing about who saw it. A robot, or a visitor who
 * sends Global Privacy Control or Do Not Track, is not counted, as a page view is not (D152). Only an active form of the store named.
 */

const seenBody = z.object({ store: z.uuid().nullable(), form: z.uuid() });

/** Counts one view of a form, when the request is a person's and the form is the store's and active. Answers whether it was counted. */
export async function recordFormSeen(h: Headers, body: unknown): Promise<boolean> {
  if (isBot(h.get("user-agent") ?? "") || wantsPrivacy(h)) return false;
  const parsed = seenBody.safeParse(body);
  if (!parsed.success) return false;
  const { store, form } = parsed.data;
  const rows = await db().execute(sql`
    insert into commerce.form_view_counts (form_id, store_id, day, views)
    select f.id, f.store_id, (now() at time zone coalesce(s.time_zone, ${PLATFORM_TIME_ZONE}))::date, 1
      from commerce.forms f left join commerce.stores s on s.id = f.store_id
     where f.id = ${form}::uuid and f.status = 'active' and ${owned(store, sql`f.store_id`)}
    on conflict (form_id, day) do update set views = commerce.form_view_counts.views + 1
    returning form_id`);
  return rows.length > 0;
}

/** Each form's views and answers (a message form's responses, a sign-up form's sign-ups) over the last `days` days, by form id. */
export async function formReport(storeId: string | null, days = 30): Promise<Map<string, { views: number; responses: number }>> {
  const rows = await typedRows(
    z.object({ id: col.uuid, views: col.int, responses: col.int }),
    sql`
      select f.id,
        coalesce((select sum(v.views) from commerce.form_view_counts v where v.form_id = f.id and v.day > current_date - ${days}::int), 0)::int as views,
        ((select count(*) from commerce.form_responses r where r.form_id = f.id and r.created_at > now() - make_interval(days => ${days}::int))
          -- A sign-up form's sign-ups are kept as subscribers with the form's id (D850).
          + (select count(*) from commerce.marketing_subscribers m where m.source = 'form' and m.source_ref = f.id::text
              and m.created_at > now() - make_interval(days => ${days}::int)))::int as responses
      from commerce.forms f where ${owned(storeId, sql`f.store_id`)}
    `,
  );
  return new Map(rows.map((r) => [r.id, { views: r.views, responses: r.responses }]));
}
