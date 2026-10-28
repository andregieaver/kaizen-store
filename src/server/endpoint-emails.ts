import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail, type RenderedEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";

import { sendEmail } from "./email";
import { log } from "./log";

type Row = Record<string, unknown>;

/**
 * Tells a store's owners that one of their endpoints was switched off after days of failed deliveries (D354): its name, its address's hint
 * and the last answer, once per owner and switch-off, in each owner's admin language. Never a payload or the secret. It never throws: the
 * endpoint's page says it was switched off anyway.
 */
export async function notifyEndpointOff(
  store: { id: string; slug: string; name: string },
  endpoint: { id: string; name: string; hint: string; since: string; error: string },
): Promise<void> {
  try {
    const owners = await db().execute<Row>(sql`
      select distinct on (a.id) a.id, a.email, a.admin_locale
      from commerce.store_members m
      join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
      where m.store_id = ${store.id}::uuid and m.disabled_at is null and m.role = 'owner' and a.email <> ''
    `);
    const emails = new Map<AdminLang, RenderedEmail>();
    const emailIn = (lang: AdminLang) => {
      if (!emails.has(lang)) {
        const words = adminText(lang, "staffEmails");
        const w = words.endpointOff;
        const since = new Date(endpoint.since).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
        const facts = { name: endpoint.name, hint: endpoint.hint, store: store.name, since, error: endpoint.error.slice(0, 200) || "-" };
        emails.set(
          lang,
          renderEmail({
            subject: fillWords(w.subject, facts),
            preview: w.preview,
            lang: ADMIN_LANG_FACTS[lang].tag,
            footer: [words.footer],
            blocks: [
              { type: "heading", text: w.heading },
              { type: "paragraph", text: fillWords(w.body, facts) },
              { type: "paragraph", text: w.after },
              { type: "button", text: w.button, url: `${siteUrl()}/admin/${store.slug}/integrations/endpoints` },
            ],
          }),
        );
      }
      return emails.get(lang)!;
    };
    for (const owner of owners) {
      await sendEmail({
        storeId: store.id,
        kind: "integration.endpoint_off",
        to: String(owner.email),
        email: emailIn(adminLangOf(typeof owner.admin_locale === "string" ? owner.admin_locale : null)),
        fromName: "Kaizena Flow",
        idempotencyKey: `integration.endpoint_off:${endpoint.id}:${endpoint.since}:${String(owner.id)}`,
      });
    }
  } catch (error) {
    log("error", "integrations.endpoint_off_email_failed", { storeId: store.id, endpointId: endpoint.id }, error);
  }
}
