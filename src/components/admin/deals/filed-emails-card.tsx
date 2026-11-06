import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { FiledEmail } from "@/server/email-filing";

/**
 * The mail filed on a deal or a company (S5, D476): the newest first, each with its subject, who sent it, when and the start of its words,
 * opened to be read whole. Drawn as text, never as HTML: a mail's words are someone else's.
 */
export function FiledEmailsCard({ emails, words: w, address, when }: { emails: FiledEmail[]; words: DealsMessages["emails"]; address: string | null; when: (iso: string) => string }) {
  return (
    <Card title={w.title} compact>
      {emails.length === 0 ? (
        <p className="text-sm text-muted">{address ? fillWords(w.none, { address }) : w.noneNoAddress}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {emails.map((email) => (
            <li key={email.id} className="flex flex-col gap-1 py-3">
              <p className="flex flex-wrap justify-between gap-2">
                <span className="text-ink">{email.subject || "—"}</span>
                <span className="text-muted">{when(email.sentAt)}</span>
              </p>
              <p className="text-muted">{fillWords(w.from, { from: email.from })}</p>
              <details>
                <summary className="cursor-pointer text-ink-2">{email.excerpt}</summary>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-sunken p-3 text-ink">{email.body}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
