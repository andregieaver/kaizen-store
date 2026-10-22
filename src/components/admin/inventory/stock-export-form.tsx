import { DialectField } from "@/components/admin/data/export-forms";
import { card, primary } from "@/components/admin/data/ui";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

/**
 * The stock file's form (wave 3, D172, `docs/wave-3-inventory.md` 2.4): only the file's format, as the file is always the same set of rows (one for each
 * variant that is shipped, at each active location). A plain HTML form that POSTs to the page's file route, which answers with the file at once (up to
 * 2,000 rows) or sends the member back with a job. No script is needed. The button is in the admin's language (`lang`, D312 A5); the format field is the
 * shared data pages' own.
 */
export function StockExportForm({ slug, lang = "en" }: { slug: string; lang?: AdminLang }) {
  return (
    <form method="post" action={`/admin/${slug}/inventory/export/file`} className={`${card} flex flex-col gap-4`}>
      <DialectField defaultValue="standard" />
      <div>
        <button type="submit" className={primary}>
          {adminText(lang, "inventory").export.button}
        </button>
      </div>
    </form>
  );
}
