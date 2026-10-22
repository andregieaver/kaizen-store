import Link from "next/link";

import { fillWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import type { EmailLogRow } from "@/server/email";

/** A list of emails as sent, newest first, each opening to what it said. */
export function EmailLog({
  emails,
  base,
  showStore = false,
  locale = "nb-NO",
  words = notificationsEn,
}: {
  emails: EmailLogRow[];
  base: string;
  showStore?: boolean;
  locale?: string;
  /** The admin's words in the account's language; English unless given. */
  words?: NotificationsMessages;
}) {
  const w = words.log;
  if (emails.length === 0) return <p className="text-sm text-muted">{w.none}</p>;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <ul className="flex flex-col divide-y divide-line text-sm">
      {emails.map((email) => (
        <li key={email.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
          <span className="min-w-0">
            <Link href={`${base}/${email.id}`} className="underline-offset-2 hover:underline">
              {email.subject}
            </Link>
            <span className="block text-xs text-muted">
              {fillWords(w.to, { to: email.to })}
              {showStore && email.storeName && ` · ${email.storeName}`}
            </span>
          </span>
          <span className="text-xs text-muted">
            <time dateTime={email.createdAt}>{when(email.createdAt)}</time> ·{" "}
            <span className={["failed", "bounced", "complained"].includes(email.status) ? "text-danger-text" : undefined}>
              {w.statuses[email.status]}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One email as the shopper saw it, in a sandboxed frame (no scripts, no forms). */
export function EmailView({ email, words = notificationsEn }: { email: EmailLogRow & { html: string }; words?: NotificationsMessages }) {
  const w = words.log;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{w.toLabel}</dt>
        <dd>{email.to}</dd>
        <dt className="text-muted">{w.subject}</dt>
        <dd>{email.subject}</dd>
        <dt className="text-muted">{w.status}</dt>
        <dd>
          {w.statuses[email.status]}
          {email.error && <span className="block text-danger-text">{email.error}</span>}
        </dd>
      </dl>
      <iframe
        title={fillWords(w.frame, { subject: email.subject })}
        srcDoc={email.html}
        sandbox=""
        className="h-[70vh] w-full rounded-panel border border-line bg-white"
      />
    </div>
  );
}
