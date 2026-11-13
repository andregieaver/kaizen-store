import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { renderEmail } from "@/lib/email-layout";
import { kaizenLifeLinkedEmail } from "@/lib/kaizen-life-emails";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

const stamp = (date: Date) => `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Tells a person, once, that their account was linked to Kaizen Life (`kaizen_life.linked:{account}:{at}`), to the account's own
 * address and in its admin language. Never throws: the link stands if email is down.
 */
export async function sendKaizenLifeLinkedEmail(
  accountId: string,
  how: "email" | "identity" | "backfill",
  at: Date = new Date(),
): Promise<SendOutcome | null> {
  try {
    const account = await typedRow(
      z.object({ email: col.text, name: col.textOrNull, admin_locale: col.textOrNull }),
      sql`select email, name, admin_locale from commerce.accounts where id = ${accountId}::uuid and disabled_at is null`,
    );
    if (!account) return null;
    const lang = adminLangOf(account.admin_locale);
    const email = renderEmail(
      kaizenLifeLinkedEmail(
        { person: account.name || account.email, when: stamp(at), how, connectedUrl: `${siteUrl()}/admin/account/connected` },
        STAFF_EMAILS_WORDS[lang],
        lang,
      ),
    );
    return await sendEmail({
      storeId: null,
      kind: "kaizen_life.linked",
      to: account.email,
      email,
      fromName: "Kaizena Flow",
      idempotencyKey: `kaizen_life.linked:${accountId}:${at.toISOString()}`,
    });
  } catch (error) {
    log("error", "kaizen_life.linked_email_failed", {}, error);
    return null;
  }
}
