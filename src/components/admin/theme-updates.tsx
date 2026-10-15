import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";

/** As the card shows them (`themeUpdates()` in `src/server/design-presets.ts`). */
export type UpdateWaiting = { installId: string; title: string; live: boolean; from: number | null; to: number; followsUpdates: boolean; whatsNew: string[] };
export type UpdateMade = { id: string; title: string; from: number | null; to: number | null; at: string; automatic: boolean; own: number; keptSettings: number; layoutsKept: string[]; undoneAt: string | null };
export type ThemeFollowing = { installId: string; title: string; live: boolean; version: number | null; followsUpdates: boolean };

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const LAYOUT_WORDS: Record<string, string> = { header: "header", footer: "footer", productLayout: "product page" };
const version = (n: number | null) => (n === null ? "the first version" : `version ${n}`);

/**
 * Updates of the store's installed themes (D245, `docs/theme-phase-2.md` step 4): what is waiting, with *What's new*, *Update now* and whether
 * each theme updates by itself; the latest updates with *Undo*. An update keeps the owner's own changes. Server-drawn.
 */
export function ThemeUpdates({
  available,
  made,
  installs,
  keepDays,
  update,
  undo,
  follow,
}: {
  available: UpdateWaiting[];
  made: UpdateMade[];
  installs: ThemeFollowing[];
  keepDays: number;
  /** Null for someone who may only look. */
  update: Action | null;
  undo: Action | null;
  follow: Action | null;
}) {
  if (available.length === 0 && made.length === 0 && installs.length === 0) return null;
  return (
    <Card
      title="Theme updates"
      description={
        <>
          When Kaizena Flow publishes a new version of a theme you installed, it can update by itself or wait for you. An update keeps every
          change you made: your own settings and CSS stay, and a header, footer or product page you edited stays yours, with the new one added as
          a draft beside it. Your words, pictures, products and menus are never touched. You can undo an update for {keepDays} days, as long as
          the theme has not changed since.
        </>
      }
      compact
    >
      <div className="flex flex-col gap-5">
        {available.map((item) => (
          <section key={item.installId} aria-label={`${item.title}: update`} className="flex flex-col gap-2 rounded-panel border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body-strong text-ink">
                {item.title}: {version(item.from)} → version {item.to}
                {item.live && (
                  <span className="ml-2">
                    <Chip signal="positive" dot>
                      Live
                    </Chip>
                  </span>
                )}
              </p>
              {update && (
                <ActionForm action={update}>
                  <input type="hidden" name="install" value={item.installId} />
                  <SubmitButton>
                    Update now<span className="sr-only"> {item.title}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
            {item.whatsNew.length > 0 ? (
              <ul aria-label="What's new" className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
                {item.whatsNew.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-ink-2">The theme&apos;s makers did not say what is new, and nothing changed that can be named.</p>
            )}
            <p className="text-caption text-muted">{item.followsUpdates ? "It will update by itself within a few minutes unless you switch that off below." : "It waits for you to update it."}</p>
          </section>
        ))}
        {installs.length > 0 && (
          <List label="How each theme is updated">
            {installs.map((item) => (
              <ListRow key={item.installId}>
                <RowLead title={item.title} sub={`${version(item.version)} · ${item.followsUpdates ? "updates by itself" : "waits for you"}`} />
                {follow && (
                  <RowActions>
                    <ActionForm action={follow}>
                      <input type="hidden" name="install" value={item.installId} />
                      <input type="hidden" name="follows" value={item.followsUpdates ? "off" : "on"} />
                      <SubmitButton variant="secondary">
                        {item.followsUpdates ? "Let me update it" : "Update it by itself"}
                        <span className="sr-only"> ({item.title})</span>
                      </SubmitButton>
                    </ActionForm>
                  </RowActions>
                )}
              </ListRow>
            ))}
          </List>
        )}
        {made.length > 0 && (
          <List label="Latest updates">
            {made.map((item) => (
              <ListRow key={item.id}>
                <RowLead
                  title={`${item.title}: ${version(item.from)} → ${version(item.to)}`}
                  sub={[
                    `${item.at.slice(0, 10)}, ${item.automatic ? "by itself" : "by hand"}`,
                    item.own > 0 ? `${item.own} of your own ${item.own === 1 ? "setting" : "settings"} kept` : null,
                    item.layoutsKept.length > 0 ? `your ${item.layoutsKept.map((kind) => LAYOUT_WORDS[kind] ?? kind).join(" and ")} kept` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                {item.undoneAt ? (
                  <Chip signal="neutral">Undone {item.undoneAt.slice(0, 10)}</Chip>
                ) : (
                  undo && (
                    <RowActions>
                      <ActionForm action={undo}>
                        <input type="hidden" name="update" value={item.id} />
                        <SubmitButton variant="secondary">
                          Undo<span className="sr-only"> the update of {item.title}</span>
                        </SubmitButton>
                      </ActionForm>
                    </RowActions>
                  )
                )}
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
