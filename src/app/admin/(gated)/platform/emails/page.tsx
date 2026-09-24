import type { Metadata } from "next";

import { EmailLog } from "@/components/admin/email-log";
import { emailSettings, listEmails } from "@/server/email";

export const metadata: Metadata = { title: "Emails" };

/** Every email Kaizen has sent or logged, and whether sending is set up (D26). */
export default async function PlatformEmailsPage() {
  const [emails, settings] = await Promise.all([listEmails({ limit: 200 }), Promise.resolve(emailSettings())]);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Emails</h1>
      <section className="rounded-lg border border-border bg-background p-5 text-sm">
        <h2 className="mb-2 font-medium">Sending</h2>
        {settings ? (
          <p>
            Sending through Amazon SES ({settings.region}) from <strong>{settings.from}</strong>, with each store&apos;s
            name as the sender and its contact address for replies.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p>
              Email is not set up, so emails are only recorded below. To send them, add these in Vercel (Settings →
              Environment Variables) and redeploy:
            </p>
            <ul className="list-disc pl-5 font-mono text-xs">
              <li>SES_REGION (e.g. eu-north-1)</li>
              <li>SES_ACCESS_KEY_ID and SES_SECRET_ACCESS_KEY (an IAM user allowed ses:SendEmail)</li>
              <li>EMAIL_FROM (an address on a domain verified in SES)</li>
            </ul>
            <p className="text-muted">
              In SES: verify the domain (DKIM records), and ask AWS to move the account out of the sandbox so it can
              email any address.
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
