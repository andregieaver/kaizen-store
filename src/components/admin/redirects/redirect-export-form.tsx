import { DialectField } from "@/components/admin/data/export-forms";
import { card, label, primary } from "@/components/admin/data/ui";
import { hint } from "@/components/admin/data/ui";
import { redirectsEn, type RedirectsMessages } from "@/lib/admin-messages/redirects.en";

/**
 * The redirect file's form (2.2.5): which redirects (the store's own by default, or all of them including the automatic ones) and the file's format. A plain
 * HTML form that POSTs to the page's file route, which answers with the file at once (up to 2,000 rows) or sends the member back with a job. No script is needed.
 */
export function RedirectExportForm({ slug, words = redirectsEn }: { slug: string; words?: RedirectsMessages }) {
  const w = words.export;
  return (
    <form method="post" action={`/admin/${slug}/redirects/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>{w.which}</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="manual" defaultChecked className="mt-1" />
          <span>
            {w.own}
            <span className={`${hint} block`}>{w.ownHelp}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="all" className="mt-1" />
          <span>
            {w.all}
            <span className={`${hint} block`}>{w.allHelp}</span>
          </span>
        </label>
      </fieldset>
      <DialectField defaultValue="standard" />
      <div>
        <button type="submit" className={primary}>
          {w.submit}
        </button>
      </div>
    </form>
  );
}
