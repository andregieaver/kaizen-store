import type { Metadata } from "next";
import { connection } from "next/server";

import { EmailLog } from "@/components/admin/email-log";
import { emailEventsSetup } from "@/lib/email-settings";
import { emailSettings, listEmails } from "@/server/email";
import { requirePlatformAdmin } from "@/server/auth";
import { Card, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Emails" };

/** Every email Kaizen has sent or logged, and whether sending is set up (D26, D32). */
export default async function PlatformEmailsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").emails;
  const [emails, settings] = await Promise.all([listEmails({ limit: 200 }), Promise.resolve(emailSettings())]);
  const webhook = emailEventsSetup() === "ok";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} />
      <Card title={w.sending} className="text-sm" compact>
        {settings ? (
          <div className="flex flex-col gap-2">
            <p>
              {w.via.split("{from}")[0]}
              <strong>{settings.from}</strong>
              {w.via.split("{from}")[1]}
            </p>
            {!webhook && (
              <p className="text-muted">
                {w.noWebhook}{" "}
                <span className="font-mono text-xs">https://kaizenaflow.com/api/resend/webhook</span>
                {w.noWebhookEnd} <span className="font-mono text-xs">RESEND_WEBHOOK_SECRET</span>.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              {w.notSetUp}
            </p>
            <ul className="list-disc pl-5 font-mono text-xs">
              <li>RESEND_API_KEY {w.keyNote}</li>
              <li>EMAIL_FROM {w.fromNote}</li>
              <li>RESEND_WEBHOOK_SECRET {w.secretNote}</li>
            </ul>
            <p className="text-muted">
              {w.region}
            </p>
          </div>
        )}
      </Card>
      <Card compact>
        <EmailLog emails={emails} base="/admin/platform/emails" showStore locale={ADMIN_LANG_FACTS[lang].locale} words={adminText(lang, "notifications")} />
      </Card>
    </div>
  );
}
