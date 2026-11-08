import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { BooksMessages } from "@/lib/admin-messages/books.en";
import type { InboxDocument } from "@/lib/books-inbox";

/**
 * Receipts by email on Settings → Books (D504): the store's books address to forward receipts to (or give suppliers), and the documents
 * waiting in the inbox, each opened in the browser and, for the owner, set aside when it is not for the books. A document is taken as a
 * purchase's receipt under its bank line, not here.
 */
export function BooksInboxCard({
  storeSlug,
  address,
  docs,
  owner,
  words: w,
  day,
  dismiss,
}: {
  storeSlug: string;
  address: string | null;
  docs: readonly InboxDocument[];
  owner: boolean;
  words: BooksMessages;
  day: (d: string) => string;
  dismiss: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const t = w.inbox;
  const list = (
    <ul className="flex flex-col divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{d.subject || d.fileName}</span>
            <span className="block text-muted">{fillWords(t.from, { from: d.from, day: day(d.receivedOn) })}</span>
          </span>
          <a href={`/admin/${storeSlug}/settings/books/inbox/${d.id}`} target="_blank" rel="noopener" className="underline underline-offset-2">
            {t.open}
            <span className="sr-only"> {d.fileName}</span>
          </a>
          {owner && (
            <SubmitButton variant="secondary" name="dismiss" value={d.id}>
              {t.dismiss}
              <span className="sr-only"> {d.fileName}</span>
            </SubmitButton>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <Card title={t.title} description={t.lead} aside={docs.length > 0 ? <Chip signal="neutral">{String(docs.length)}</Chip> : undefined}>
      <div className="flex flex-col gap-4 text-sm">
        {address ? (
          <p>
            <span className="text-muted">{t.address}: </span>
            <code className="select-all break-all font-medium">{address}</code>
          </p>
        ) : (
          <p className="text-muted">{t.notSetUp}</p>
        )}
        {docs.length === 0 ? <p className="text-muted">{t.none}</p> : <p>{countWords(docs.length, t.waiting)}</p>}
        {docs.length > 0 && (owner ? <ActionForm action={dismiss}>{list}</ActionForm> : list)}
      </div>
    </Card>
  );
}
