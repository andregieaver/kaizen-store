import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { ownersNoticeEmail } from "@/lib/privacy-emails";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";
import { privacyStore } from "./privacy-subject";

type Row = Record<string, unknown>;
const strs = (v: unknown): string => String(v ?? "");

/**
 * The notices to a store's owners about what staff did with a person's data (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 7): English,
 * who did it, when and the request, never the person. With the typed confirmation and the permission check they take the place of Shopify's
 * 10-day cancel window.
 */

/** Tells every owner of the store that staff downloaded or erased a person's data (English, no personal data in it). Returns how many were emailed. */
export async function notifyOwners(storeId: string, action: "export" | "erasure", actorId: string, requestId: string | null, now: Date, url: string | null): Promise<number> {
  const store = await privacyStore(storeId);
  if (!store) return 0;
  const [actor] = await db().execute<Row>(sql`select coalesce(nullif(name, ''), email) as who from commerce.accounts where id = ${actorId}::uuid`);
  const owners = await db().execute<Row>(sql`
    select distinct on (a.id) a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null and a.email <> ''
  `);
  const content = ownersNoticeEmail({
    storeName: store.name,
    action,
    actor: strs(actor?.who ?? "A staff member"),
    when: `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    requestId,
    url: url ?? `${siteUrl()}/admin/${store.slug}/privacy${requestId ? `/${requestId}` : ""}`,
  });
  const email = renderEmail(content);
  let sent = 0;
  for (const owner of owners) {
    const outcome = await sendEmail({
      storeId,
      kind: "privacy.owners_notice",
      to: strs(owner.email),
      email,
      fromName: "Kaizen",
      idempotencyKey: `privacy.owners:${action}:${requestId ?? now.getTime()}:${actorId}:${strs(owner.id)}`,
    });
    if (outcome === "sent" || outcome === "logged") sent++;
  }
  return sent;
}
