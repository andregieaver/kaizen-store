import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { DESIGN_WORDS } from "@/lib/admin-words/design";

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
  timeZone,
}: {
  runs: FollowRun[];
  /** The admin's language (D312 A7); English unless given. */
  lang?: AdminLang;
  /** The time zone its dates are read in: the store's, or the platform's on Kaizena Flow's own pages (D786). */
  timeZone: string;
  keepDays: number;
  /** Null for someone who may only look. */
  count: Action | null;
  run: Action | null;
  undo: Action | null;
}) {
  const { common: c, follow: w } = DESIGN_WORDS[lang];
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
                title={fillWords(w.runTitle, { date: adminDate(timeZone, r.at, "day", lang), settings: settings(r.followed), pages: pages(r.pages) })}
                sub={r.kept > 0 ? fillWords(w.keptOwn, { settings: settings(r.kept) }) : w.nothingOwn}
              />
              {r.undoneAt ? (
                <Chip signal="neutral">{fillWords(c.undone, { date: adminDate(timeZone, r.undoneAt, "day", lang) })}</Chip>
              ) : (
                undo && (
                  <RowActions>
                    <ActionForm action={undo}>
                      <input type="hidden" name="run" value={r.runId} />
                      <SubmitButton variant="secondary">
                        {c.undo}<span className="sr-only"> {fillWords(w.undoName, { date: adminDate(timeZone, r.at, "day", lang) })}</span>
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
