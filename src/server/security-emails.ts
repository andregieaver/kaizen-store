import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail } from "@/lib/email-layout";
import { securityEmail, type SecurityEvent } from "@/lib/security-emails";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";

type Row = Record<string, unknown>;

const stamp = (date: Date) =>
  `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/**
 * Tells a person that something happened to their own sign-in security. It goes to the account's own address (never one anyone typed
 * for the occasion), once per event and moment (`security.{event}:{account}:{at}`), is kept in the email log, and never throws: if
 * email is down the event stands, as the recovery code or the reset has already done its work.
 */
export async function sendSecurityEmail(
  accountId: string,
  event: SecurityEvent,
  options: { at?: Date; codesLeft?: number; by?: string | null } = {},
): Promise<SendOutcome | null> {
  try {
    const [account] = await db().execute<Row>(
      sql`select email, name, admin_locale from commerce.accounts where id = ${accountId}::uuid and disabled_at is null`,
    );
    if (!account || !account.email) return null;
    const at = options.at ?? new Date();
    const lang = adminLangOf(
      typeof account.admin_locale === "string" ? account.admin_locale : null,
    );
    const email = renderEmail(
      securityEmail(
        {
          event,
          person: String(account.name || account.email),
          when: stamp(at),
          codesLeft: options.codesLeft,
          by: options.by ?? null,
          signInUrl: `${siteUrl()}/admin/sign-in`,
        },
        adminText(lang, "staffEmails"),
        lang,
      ),
    );
    return await sendEmail({
      storeId: null,
      kind: `security.${event}`,
      to: String(account.email),
      email,
      fromName: "Kaizena Flow",
      idempotencyKey: `security.${event}:${accountId}:${at.toISOString()}`,
    });
  } catch (error) {
    console.error("[security] the email could not be sent", event, error);
    return null;
  }
}
