import Link from "next/link";

import type { SiteLayoutType } from "@/server/site-layouts";
import type { PageSummary } from "@/server/pages";

import { ActionForm, SubmitButton, type FormState } from "./action-form";

/**
 * A site's headers or footers (D80), Kaizen's or a store's: which one it
 * shows, and the list to edit them.
 */

const STATES: Record<PageSummary["state"], string> = {
  draft: "Draft",
  published: "Published",
  changed: "Published, with unpublished changes",
};

/** Which header or footer the site shows: the standard one, or one of its published ones. */
export function SiteLayoutChoice({
  type,
  layouts,
  current,
  siteName,
  action,
}: {
  type: SiteLayoutType;
  layouts: PageSummary[];
  current: string | null;
  /** "Your store" or "Kaizen's pages". */
  siteName: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const choices = layouts.filter((layout) => layout.state !== "draft" || layout.id === current);
  const unpublished = layouts.find((layout) => layout.id === current)?.state === "draft";
  return (
    <ActionForm action={action} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
      <h2 className="font-medium">The {type} in use</h2>
      <p className="max-w-2xl text-sm text-muted">
        {siteName} shows this {type} on every page. Publish a {type} to choose it; the standard one looks as it always has.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {siteName} shows
          <select name="layout" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">
            <option value="">The standard {type}</option>
            {choices.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.title || "Untitled"}
                {layout.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </div>
      {unpublished && <p className="text-sm text-muted">This {type} is not published, so the standard one shows until you publish it again.</p>}
    </ActionForm>
  );
}

/** The site's headers or footers: name, state, and which is in use. */
export function SiteLayoutsTable({ layouts, adminBase, current }: { layouts: PageSummary[]; adminBase: string; current: string | null }) {
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              State
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              In use
            </th>
          </tr>
        </thead>
        <tbody>
          {layouts.map((layout) => (
            <tr key={layout.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2">
                <Link href={`${adminBase}/${layout.id}`} className="font-medium underline">
                  {layout.title || "Untitled"}
                </Link>
              </td>
              <td className="px-4 py-2">
                {STATES[layout.state]}
                {layout.publishedAt && <span className="block text-muted">Published {date.format(new Date(layout.publishedAt))}</span>}
              </td>
              <td className="px-4 py-2">{layout.id === current ? "In use" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
