import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

type Action = (state: never, form: FormData) => Promise<never>;

/**
 * One of Kaizen's pages chosen for a place of its own (D143, as a store's front page and special pages, D54, D112):
 * which published page the place shows, or the standard one, and a starter page to begin from, published in place.
 * The actions are bound to the place by the page that draws the form.
 */
export async function PagePlaceForm({
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
  const w = adminText(await requestAdminLang(), "screens").pagePlace;
  return (
    <Card title={name} description={hint} level={3} className="flex flex-col gap-3" compact>
      <ActionForm action={choose as never} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {fillWords(w.shows, { name })}
          <select name="page" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{standard}</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title || w.untitled}
                {page.state === "draft" ? w.notPublished : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>{w.save}</SubmitButton>
      </ActionForm>
      <ActionForm action={start as never} className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary">{w.start}</SubmitButton>
        <span className="text-sm text-muted">{w.startHint}</span>
      </ActionForm>
      {unpublished && <p className="text-sm text-muted">{fillWords(w.unpublished, { standard: standard.toLowerCase() })}</p>}
    </Card>
  );
}
