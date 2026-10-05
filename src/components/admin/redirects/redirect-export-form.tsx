import { DialectField } from "@/components/admin/data/export-forms";
import { card, label, primary } from "@/components/admin/data/ui";
import { hint } from "@/components/admin/data/ui";

/**
 * The redirect file's form (2.2.5): which redirects (the store's own by default, or all of them including the automatic ones) and the file's format. A plain
 * HTML form that POSTs to the page's file route, which answers with the file at once (up to 2,000 rows) or sends the member back with a job. No script is needed.
 */
export function RedirectExportForm({ slug }: { slug: string }) {
  return (
    <form method="post" action={`/admin/${slug}/redirects/export/file`} className={`${card} flex flex-col gap-4`}>
      <fieldset className="flex flex-col gap-2">
        <legend className={label}>Which redirects</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="manual" defaultChecked className="mt-1" />
          <span>
            Your own redirects
            <span className={`${hint} block`}>The ones added by hand, imported or made from the pages-not-found report. The file reads back into this store as it is: every line is unchanged.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="scope" value="all" className="mt-1" />
          <span>
            All redirects, the automatic ones too
            <span className={`${hint} block`}>Adds the redirects Kaizen made when a product, category or tag changed its address.</span>
          </span>
        </label>
      </fieldset>
      <DialectField defaultValue="standard" />
      <div>
        <button type="submit" className={primary}>
          Export redirects
        </button>
      </div>
    </form>
  );
}
