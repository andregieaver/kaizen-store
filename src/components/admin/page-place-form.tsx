import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";

type Action = (state: never, form: FormData) => Promise<never>;

/**
 * One of Kaizen's pages chosen for a place of its own (D143, as a store's front page and special pages, D54, D112):
 * which published page the place shows, or the standard one, and a starter page to begin from, published in place.
 * The actions are bound to the place by the page that draws the form.
 */
export function PagePlaceForm({
  name,
  hint,
  standard,
  current,
  pages,
  choose,
  start,
}: {
  name: string;
  hint: string;
  standard: string;
  current: string | null;
  pages: { id: string; title: string; state: string }[];
  choose: Action;
  start: Action;
}) {
  const unpublished = pages.find((p) => p.id === current)?.state === "draft";
  return (
    <Card title={name} description={hint} level={3} className="flex flex-col gap-3" compact>
      <ActionForm action={choose as never} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {name} shows
          <select name="page" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{standard}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || "Untitled"}
                {page.state === "draft" ? " (not published)" : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>Save</SubmitButton>
      </ActionForm>
      <ActionForm action={start as never} className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">Start from a new page</SubmitButton>
        <span className="text-sm text-muted">Makes a page like the standard one, publishes it here and opens it in the builder.</span>
      </ActionForm>
      {unpublished && <p className="text-sm text-muted">This page is not published, so visitors see {standard.toLowerCase()} until you publish it again.</p>}
    </Card>
  );
}
