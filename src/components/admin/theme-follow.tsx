import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

/** A run of the page migration as the card shows it (`DetachRun` in `src/server/theme-detach.ts`). */
export type FollowRun = { runId: string; at: string; pages: number; followed: number; kept: number; undoneAt: string | null };

type Action = (state: FormState, formData: FormData) => Promise<FormState>;


/**
 * *Let pages follow the theme* (D243, `docs/theme-phase-2.md` step 2): takes out of the store's pages the style settings that only repeat
 * the live theme, so they look exactly as now and follow the theme once it changes; the latest runs, each with *Undo*. Server-drawn.
 */
export function ThemeFollow({
  runs,
  keepDays,
  count,
  run,
  undo,
  lang = "en",
}: {
  runs: FollowRun[];
  /** The admin's language (D312 A7); English unless given. */
  lang?: AdminLang;
  keepDays: number;
  /** Null for someone who may only look. */
  count: Action | null;
  run: Action | null;
  undo: Action | null;
}) {
  const { common: c, follow: w } = adminText(lang, "design");
  const settings = (n: number) => countWords(n, c.settings);
  const pages = (n: number) => countWords(n, c.pages);
  return (
    <Card title={w.title} description={fillWords(w.description, { days: keepDays })} compact>
      {(count || run) && (
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {count && (
            <ActionForm action={count}>
              <SubmitButton variant="secondary">{w.count}</SubmitButton>
            </ActionForm>
          )}
          {run && (
            <ActionForm action={run}>
              <SubmitButton>{w.run}</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      {runs.length > 0 && (
        <List label={w.latest}>
          {runs.map((r) => (
            <ListRow key={r.runId}>
              <RowLead
                title={fillWords(w.runTitle, { date: r.at.slice(0, 10), settings: settings(r.followed), pages: pages(r.pages) })}
                sub={r.kept > 0 ? fillWords(w.keptOwn, { settings: settings(r.kept) }) : w.nothingOwn}
              />
              {r.undoneAt ? (
                <Chip signal="neutral">{fillWords(c.undone, { date: r.undoneAt.slice(0, 10) })}</Chip>
              ) : (
                undo && (
                  <RowActions>
                    <ActionForm action={undo}>
                      <input type="hidden" name="run" value={r.runId} />
                      <SubmitButton variant="secondary">
                        {c.undo}<span className="sr-only"> {fillWords(w.undoName, { date: r.at.slice(0, 10) })}</span>
                      </SubmitButton>
                    </ActionForm>
                  </RowActions>
                )
              )}
            </ListRow>
          ))}
        </List>
      )}
    </Card>
  );
}
