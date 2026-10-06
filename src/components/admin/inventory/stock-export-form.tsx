import { DialectField } from "@/components/admin/data/export-forms";
import { card, primary } from "@/components/admin/data/ui";

/**
 * The stock file's form (wave 3, D172, `docs/wave-3-inventory.md` 2.4): only the file's format, as the file is always the same set of rows (one for each
 * variant that is shipped, at each active location). A plain HTML form that POSTs to the page's file route, which answers with the file at once (up to
 * 2,000 rows) or sends the member back with a job. No script is needed.
 */
export function StockExportForm({ slug }: { slug: string }) {
  return (
    <form method="post" action={`/admin/${slug}/inventory/export/file`} className={`${card} flex flex-col gap-4`}>
      <DialectField defaultValue="standard" />
      <div>
        <button type="submit" className={primary}>
          Export stock
        </button>
      </div>
    </form>
  );
}
