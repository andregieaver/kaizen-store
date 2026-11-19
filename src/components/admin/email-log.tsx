import Link from "next/link";

import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { emailDays } from "@/lib/email-log";
import type { EmailLogRow } from "@/server/email";

/** A list of emails as sent, newest first, each opening to what it said. */
export function EmailLog({
  emails,
  base,
  showStore = false,
  locale = "nb-NO",
  words = notificationsEn,
  now,
  quietUnsent = false,
  timeZone,
}: {
  emails: EmailLogRow[];
  base: string;
  showStore?: boolean;
  locale?: string;
  /** The admin's words in the account's language; English unless given. */
  words?: NotificationsMessages;
  /** Group the emails by day, Today and Yesterday counted from this time (round 16, D650); a flat list without it. */
  now?: number;
  /** While email is not set up, a row leaves out "Not sent": the page's sentence says it once (round 17, D652). Failures still show. */
  quietUnsent?: boolean;
  /** The days and times' zone: the store's, or the platform's on Kaizena Flow's own log (D786). */
  timeZone: string;
}) {
  const w = words.log;
  if (emails.length === 0) return <p className="text-sm text-muted">{w.none}</p>;
  const when = (iso: string) => adminDate(timeZone, iso, "dayTime", locale);
  const quiet = (status: EmailLogRow["status"]) => quietUnsent && status === "logged";
  const time = (iso: string) => adminDate(timeZone, iso, "time", locale);
  const list = (rows: EmailLogRow[]) => (
    <ul className="flex flex-col divide-y divide-line text-sm">
      {rows.map((email) => (
        <li key={email.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
          <span className="min-w-0 max-w-full">
            <Link href={`${base}/${email.id}`} className="block truncate underline-offset-2 hover:underline sm:whitespace-normal">
              {email.subject}
            </Link>
            <span className="block text-xs text-muted">
              {/* On a phone the address waits for the email itself (round 17): one line of when and where. */}
              <span className="hidden sm:inline">{fillWords(w.to, { to: email.to })}</span>
              {showStore && email.storeName && <span className="hidden sm:inline">{` · ${email.storeName}`}</span>}
              <span className="sm:hidden">
                {[now === undefined ? when(email.createdAt) : time(email.createdAt), showStore ? email.storeName : null, quiet(email.status) ? null : w.statuses[email.status]]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </span>
          <span className="hidden text-xs text-muted sm:inline">
            <time dateTime={email.createdAt}>{now === undefined ? when(email.createdAt) : time(email.createdAt)}</time>
            {!quiet(email.status) && (
              <>
                {" · "}
                <span className={["failed", "bounced", "complained"].includes(email.status) ? "text-danger-text" : undefined}>{w.statuses[email.status]}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
  if (now === undefined) return list(emails);
  return (
    <div className="flex flex-col gap-4">
      {emailDays(emails, now, w, timeZone, locale).map((day) => (
        <section key={day.label} className="flex flex-col gap-1">
          <h3 className="text-eyebrow text-muted uppercase">{day.label}</h3>
          {list(day.rows)}
        </section>
      ))}
    </div>
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
