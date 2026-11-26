import { Card } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/action-form";
import type { AdminLang } from "@/lib/admin-lang";
import type { AdminUseMessages } from "@/lib/admin-messages/admin-use.en";
import type { AdminSignalChoice } from "@/lib/admin-signals";

/**
 * A store owner's own choice about heatmaps and recordings of how they use the admin (D895 phase 3b): the two choices, each off until
 * ticked, the short notice the law asks for at the point of asking (what, what never, how long, who sees it, the basis, the rights) and a
 * link to the full privacy notice. A plain form posted to `/admin/account/admin-use`; shown once on the store's home as the ask, and in
 * account settings to change it.
 */
export function AdminUseChoice({ words, lang, from, choice }: { words: AdminUseMessages; lang: AdminLang; from: string; choice: AdminSignalChoice | null }) {
  const w = words.ask;
  return (
    <Card title={w.title} description={w.lead}>
      <form method="post" action="/admin/account/admin-use" className="flex flex-col gap-3">
        <input type="hidden" name="from" value={from} />
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="heatmaps" defaultChecked={choice?.heatmaps ?? false} className="mt-1" />
          <span>
            <span className="text-body-strong text-ink">{w.allowHeat}</span>
            <span className="block text-muted">{w.heatmaps}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="recordings" defaultChecked={choice?.recordings ?? false} className="mt-1" />
          <span>
            <span className="text-body-strong text-ink">{w.allowRec}</span>
            <span className="block text-muted">{w.recordings}</span>
          </span>
        </label>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-muted">
          <li>{w.collected}</li>
          <li>{w.excluded}</li>
          <li>{w.kept}</li>
          <li>{w.access}</li>
          <li>{w.basis}</li>
          <li>{w.rights}</li>
        </ul>
        <a href={lang === "nb" ? "/no/privacy" : "/privacy"} className="text-sm text-ink underline underline-offset-2">
          {w.notice}
        </a>
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="intent" value="save">
            {w.save}
          </SubmitButton>
          {choice === null && (
            <SubmitButton name="intent" value="no" variant="secondary" skipValidation>
              {w.no}
            </SubmitButton>
          )}
        </div>
      </form>
    </Card>
  );
}
