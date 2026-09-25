import type { Metadata } from "next";
import { connection } from "next/server";

import { EmailLog } from "@/components/admin/email-log";
import { emailEventsSetup } from "@/lib/email-settings";
import { emailSettings, listEmails } from "@/server/email";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Emails" };

/** Every email Kaizen has sent or logged, and whether sending is set up (D26, D32). */
export default async function PlatformEmailsPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [emails, settings] = await Promise.all([listEmails({ limit: 200 }), Promise.resolve(emailSettings())]);
  const webhook = emailEventsSetup() === "ok";
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Emails</h1>
      <section className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 className="mb-2 font-medium">Sending</h2>
        {settings ? (
          <div className="flex flex-col gap-2">
            <p>
              Sending through Resend from <strong>{settings.from}</strong>, with each store&apos;s name as the sender
              and its contact address for replies.
            </p>
            {!webhook && (
              <p className="text-muted">
                Deliveries and bounces are not reported back yet: add a webhook in Resend (Webhooks → Add endpoint,{" "}
                <span className="font-mono text-xs">https://kaizenstore.cloud/api/resend/webhook</span>, all email
                events) and put its signing secret in Vercel as <span className="font-mono text-xs">RESEND_WEBHOOK_SECRET</span>.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              Email is not set up, so emails are only recorded below. To send them, add these in Vercel (Settings →
              Environment Variables) and redeploy:
            </p>
            <ul className="list-disc pl-5 font-mono text-xs">
              <li>RESEND_API_KEY (a sending-access key, starts with re_)</li>
              <li>EMAIL_FROM (an address on the domain verified in Resend, e.g. butikk@kaizenstore.cloud)</li>
              <li>RESEND_WEBHOOK_SECRET (the webhook&apos;s signing secret, starts with whsec_)</li>
            </ul>
            <p className="text-muted">
              In Resend: add the domain in the Ireland (eu-west-1) region and put its DNS records at the domain&apos;s
              DNS host.
            </p>
          </div>
        )}
      </section>
      <section className="rounded-lg border border-border bg-background p-5">
        <EmailLog emails={emails} base="/admin/platform/emails" showStore />
      </section>
    </div>
  );
}
