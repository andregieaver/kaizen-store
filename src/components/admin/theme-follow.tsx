import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";

/** A run of the page migration as the card shows it (`DetachRun` in `src/server/theme-detach.ts`). */
export type FollowRun = { runId: string; at: string; pages: number; followed: number; kept: number; undoneAt: string | null };

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const settings = (n: number) => `${n} ${n === 1 ? "setting" : "settings"}`;
const pages = (n: number) => `${n} ${n === 1 ? "page" : "pages"}`;

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
}: {
  runs: FollowRun[];
  keepDays: number;
  /** Null for someone who may only look. */
  count: Action | null;
  run: Action | null;
  undo: Action | null;
}) {
  return (
    <Card
      title="Let pages follow the theme"
      description={
        <>
          Pages made before themes could be switched carry style settings of their own that only repeat the theme: a heading&apos;s size, a
          row&apos;s padding. Taking those out leaves every page looking exactly as it does now, and from then on it follows the theme you
          switch to. Settings that differ from the theme are yours and stay. Words, pictures, videos and links are never touched. You can undo
          a run for {keepDays} days, page by page as long as you have not changed the page since.
        </>
      }
      compact
    >
      {(count || run) && (
        <div className="mb-4 flex flex-wrap items-start gap-3">
          {count && (
            <ActionForm action={count}>
              <SubmitButton variant="secondary">Count the settings</SubmitButton>
            </ActionForm>
          )}
          {run && (
            <ActionForm action={run}>
              <SubmitButton>Make pages follow the theme</SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
      {runs.length > 0 && (
        <List label="Latest runs">
          {runs.map((r) => (
            <ListRow key={r.runId}>
              <RowLead
                title={`${r.at.slice(0, 10)}: ${settings(r.followed)} on ${pages(r.pages)}`}
                sub={r.kept > 0 ? `${settings(r.kept)} kept as your own` : "Nothing of your own on them"}
              />
              {r.undoneAt ? (
                <Chip signal="neutral">Undone {r.undoneAt.slice(0, 10)}</Chip>
              ) : (
                undo && (
                  <RowActions>
                    <ActionForm action={undo}>
                      <input type="hidden" name="run" value={r.runId} />
                      <SubmitButton variant="secondary">
                        Undo<span className="sr-only"> the run of {r.at.slice(0, 10)}</span>
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
