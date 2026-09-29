import { secondaryButton } from "./work-parts";

/**
 * The invoices list's CSV downloads (docs/work.md 1.9, 7.2 WP7b): the register of the issued invoices the list is showing
 * (`query` is the list's own address query, so the file has the same filters) and the payments received. Plain links to
 * the route handlers, which check the member and that Work is on; a browser saves the file.
 */
export function InvoiceExportSlot({ storeSlug, query }: { storeSlug: string; query: string }) {
  const base = `/admin/${storeSlug}/work`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`${base}/invoices/export${query}`} download className={secondaryButton}>
        Export invoices (CSV)
      </a>
      <a href={`${base}/payments/export`} download className={secondaryButton}>
        Export payments (CSV)
      </a>
    </div>
  );
}
