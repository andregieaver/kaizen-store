import Link from "next/link";

import type { EmailLogRow } from "@/server/email";

const STATUS: Record<EmailLogRow["status"], string> = {
  queued: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  bounced: "Bounced (address does not take email)",
  complained: "Marked as spam by the recipient",
  logged: "Not sent (email not set up)",
};

/** A list of emails as sent, newest first, each opening to what it said. */
export function EmailLog({
  emails,
  base,
  showStore = false,
  locale = "nb-NO",
}: {
  emails: EmailLogRow[];
  base: string;
  showStore?: boolean;
  locale?: string;
}) {
  if (emails.length === 0) return <p className="text-sm text-muted">No emails yet.</p>;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <ul className="flex flex-col divide-y divide-border text-sm">
      {emails.map((email) => (
        <li key={email.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
          <span className="min-w-0">
            <Link href={`${base}/${email.id}`} className="underline-offset-2 hover:underline">
              {email.subject}
            </Link>
            <span className="block text-xs text-muted">
              to {email.to}
              {showStore && email.storeName && ` · ${email.storeName}`}
            </span>
          </span>
          <span className="text-xs text-muted">
            <time dateTime={email.createdAt}>{when(email.createdAt)}</time> ·{" "}
            <span className={["failed", "bounced", "complained"].includes(email.status) ? "text-red-700 dark:text-red-400" : undefined}>
              {STATUS[email.status]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One email as the shopper saw it, in a sandboxed frame (no scripts, no forms). */
export function EmailView({ email }: { email: EmailLogRow & { html: string } }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">To</dt>
        <dd>{email.to}</dd>
        <dt className="text-muted">Subject</dt>
        <dd>{email.subject}</dd>
        <dt className="text-muted">Status</dt>
        <dd>
          {STATUS[email.status]}
          {email.error && <span className="block text-red-700 dark:text-red-400">{email.error}</span>}
        </dd>
      </dl>
      <iframe
        title={`Email: ${email.subject}`}
        srcDoc={email.html}
        sandbox=""
        className="h-[70vh] w-full rounded-lg border border-border bg-white"
      />
    </div>
  );
}
