import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

/** As the card shows them (`themeUpdates()` in `src/server/design-presets.ts`). */
export type UpdateWaiting = { installId: string; title: string; live: boolean; from: number | null; to: number; followsUpdates: boolean; whatsNew: string[] };
export type UpdateMade = { id: string; title: string; from: number | null; to: number | null; at: string; automatic: boolean; own: number; keptSettings: number; layoutsKept: string[]; undoneAt: string | null };
export type ThemeFollowing = { installId: string; title: string; live: boolean; version: number | null; followsUpdates: boolean };

type Action = (state: FormState, formData: FormData) => Promise<FormState>;


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
  description,
  lang = "en",
}: {
  available: UpdateWaiting[];
  made: UpdateMade[];
  installs: ThemeFollowing[];
  keepDays: number;
  /** Null for someone who may only look. */
  update: Action | null;
  undo: Action | null;
  follow: Action | null;
  /** What the card says above the updates; a store's words unless given (Kaizena Flow's own site has its own, D253). */
  description?: string;
  /** The admin's language (D312 A7); English unless given. */
  lang?: AdminLang;
}) {
  if (available.length === 0 && made.length === 0 && installs.length === 0) return null;
  const { common: c, updates: w } = adminText(lang, "design");
  const version = (n: number | null) => (n === null ? c.firstVersion : fillWords(c.versionLower, { n }));
  return (
    <Card title={w.title} description={description ?? fillWords(w.description, { days: keepDays })} compact>
      <div className="flex flex-col gap-5">
        {available.map((item) => (
          <section key={item.installId} aria-label={fillWords(w.updateLabel, { name: item.title })} className="flex flex-col gap-2 rounded-panel border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body-strong text-ink">
                {fillWords(w.fromTo, { name: item.title, from: version(item.from), to: item.to })}
                {item.live && (
                  <span className="ml-2">
                    <Chip signal="positive" dot>
                      {c.live}
                    </Chip>
                  </span>
                )}
              </p>
              {update && (
                <ActionForm action={update}>
                  <input type="hidden" name="install" value={item.installId} />
                  <SubmitButton>
                    {w.updateNow}<span className="sr-only"> {item.title}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
            {item.whatsNew.length > 0 ? (
              <ul aria-label={w.whatsNew} className="flex list-disc flex-col gap-1 pl-5 text-body text-ink-2">
                {item.whatsNew.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-body text-ink-2">{w.nothingNamed}</p>
            )}
            <p className="text-caption text-muted">{item.followsUpdates ? w.byItselfSoon : w.waits}</p>
          </section>
        ))}
        {installs.length > 0 && (
          <List label={w.howUpdated}>
            {installs.map((item) => (
              <ListRow key={item.installId}>
                <RowLead title={item.title} sub={`${version(item.version)} · ${item.followsUpdates ? w.updatesByItself : w.waitsForYou}`} />
                {follow && (
                  <RowActions>
                    <ActionForm action={follow}>
                      <input type="hidden" name="install" value={item.installId} />
                      <input type="hidden" name="follows" value={item.followsUpdates ? "off" : "on"} />
                      <SubmitButton variant="secondary">
                        {item.followsUpdates ? w.letMe : w.byItself}
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
          <List label={w.latest}>
            {made.map((item) => (
              <ListRow key={item.id}>
                <RowLead
                  title={fillWords(w.madeTitle, { name: item.title, from: version(item.from), to: version(item.to) })}
                  sub={[
                    fillWords(w.madeWhen, { date: item.at.slice(0, 10), how: item.automatic ? w.automatic : w.byHand }),
                    item.own > 0 ? countWords(item.own, w.ownKept) : null,
                    item.layoutsKept.length > 0 ? fillWords(w.layoutsKept, { layouts: item.layoutsKept.map((kind) => w.layouts[kind] ?? kind).join(w.and) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
                {item.undoneAt ? (
                  <Chip signal="neutral">{fillWords(c.undone, { date: item.undoneAt.slice(0, 10) })}</Chip>
                ) : (
                  undo && (
                    <RowActions>
                      <ActionForm action={undo}>
                        <input type="hidden" name="update" value={item.id} />
                        <SubmitButton variant="secondary">
                          {c.undo}<span className="sr-only"> {fillWords(w.undoName, { name: item.title })}</span>
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
