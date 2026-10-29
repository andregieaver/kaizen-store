"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { LookArea, PageDifference } from "@/lib/version-compare";

import { useAdminText } from "./admin-text";
import { Button, ButtonLink, Card, Chip, List, ListRow, RowLead } from "./ui";
import { VersionDifferences } from "./version-differences";

type Done = { ok: true } | { ok: false; problem: string };
type AsyncDone = Promise<Done>;
type Outcome = {
  pages: { id: string; title: string; ok: boolean; problem?: string }[];
  theme: { title: string; ok: boolean; problem?: string } | null;
  menus: { id: string; name: string; ok: boolean; problem?: string }[];
};
type AsyncPublished = Promise<{ ok: true; outcome: Outcome } | { ok: false; problem: string; changed?: { id: string; title: string }[] }>;

export type StagingView = {
  open: { name: string; since: string; installId: string | null } | null;
  pages: {
    id: string;
    title: string;
    type: string;
    isNew: boolean;
    staged: boolean;
    differences: PageDifference[];
    editHref: string;
    /** Staged as the set's own copy (D385): `editHref` opens the copy. */
    copy: boolean;
    liveChanged: { changed: boolean; differences: PageDifference[] };
  }[];
  themes: { id: string; title: string; areas: LookArea[] }[];
  menus: { id: string; name: string; staged: { name: string; before: number; after: number; renamed: boolean } | null; stageHref: string }[];
  last: { name: string; status: string; when: string | null; outcome: Outcome | null } | null;
};

export type StagingActions = {
  start: (name: string) => AsyncDone;
  stagePage: (id: string, staged: boolean) => AsyncDone;
  /** Keeps a copy whose live page changed since it was made (D385). */
  keepCopy: (id: string) => AsyncDone;
  stageTheme: (installId: string | null) => AsyncDone;
  dropMenu: (id: string) => AsyncDone;
  discard: () => AsyncDone;
  publish: () => AsyncPublished;
};

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/** The staging page (D358): start a set, tick pages, choose a theme, stage menus, compare each, and make them live together. */
export function SiteStaging({ view, canWrite, actions }: { view: StagingView; canWrite: boolean; actions: StagingActions }) {
  const w = useAdminText("website").staging;
  const lookWords = useAdminText("schedules").versions.areas;
  const [pending, run] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const say = (code: string) => (w.problems as Record<string, string>)[code] ?? code;
  const act = (work: () => AsyncDone) =>
    run(async () => {
      const done = await work();
      setProblem(done.ok ? null : say(done.problem));
    });
  const somethingStaged = view.open && (view.pages.some((p) => p.staged) || view.open.installId || view.menus.some((m) => m.staged));

  const outcomeList = (o: Outcome) => (
    <ul className="flex flex-col gap-1 text-sm" data-staging-outcome>
      {[
        ...o.pages.map((p) => ({ key: `p${p.id}`, name: p.title, ok: p.ok, problem: p.problem })),
        ...(o.theme ? [{ key: "theme", name: o.theme.title, ok: o.theme.ok, problem: o.theme.problem }] : []),
        ...o.menus.map((m) => ({ key: `m${m.id}`, name: m.name, ok: m.ok, problem: m.problem })),
      ].map((part) => (
        <li key={part.key}>
          {part.name}: {part.ok ? w.partOk : fillWords(w.partRefused, { problem: say(part.problem ?? "failed") })}
        </li>
      ))}
    </ul>
  );

  if (!view.open) {
    return (
      <div className="flex flex-col gap-6">
        {outcome && <Card title={w.lastTitle}>{outcomeList(outcome)}</Card>}
        <Card title={w.start}>
          <p className="mb-3 text-sm text-muted">{w.noneOpen}</p>
          {canWrite && (
            <form
              aria-busy={pending}
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => actions.start(name));
              }}
            >
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder={w.namePlaceholder} className={`${FIELD} min-w-64 flex-1`} aria-label={w.start} />
              <Button type="submit" kind="main" disabled={pending}>
                {pending ? w.starting : w.start}
              </Button>
            </form>
          )}
          {problem && (
            <p role="alert" className="mt-2 text-sm text-danger-text">
              {problem}
            </p>
          )}
        </Card>
        {view.last && (
          <Card title={w.lastTitle}>
            <p className="text-sm">
              {view.last.status === "published" ? fillWords(w.lastPublished, { name: view.last.name, when: view.last.when ?? "" }) : fillWords(w.lastDiscarded, { name: view.last.name })}
            </p>
            {view.last.outcome && outcomeList(view.last.outcome)}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" aria-busy={pending}>
      <Card
        title={fillWords(w.open, { name: view.open.name })}
        description={fillWords(w.since, { when: view.open.since })}
        aside={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              <Button
                kind="quiet"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(w.discardConfirm)) act(() => actions.discard());
                }}
              >
                {w.discard}
              </Button>
              <Button
                kind="main"
                disabled={pending || !somethingStaged}
                onClick={() => {
                  if (!window.confirm(w.publishConfirm)) return;
                  run(async () => {
                    const done = await actions.publish();
                    if (done.ok) {
                      setOutcome(done.outcome);
                      setProblem(null);
                    } else setProblem(done.changed ? fillWords(w.problems.changed, { titles: done.changed.map((c) => c.title).join(", ") }) : say(done.problem));
                  });
                }}
              >
                {pending ? w.publishing : w.publish}
              </Button>
            </div>
          ) : undefined
        }
      >
        {!somethingStaged && <p className="text-sm text-muted">{w.nothingStaged}</p>}
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {problem}
          </p>
        )}
      </Card>

      <Card title={w.pagesTitle} description={w.pagesHint}>
        {view.pages.length === 0 ? (
          <p className="text-sm text-muted">{w.noPages}</p>
        ) : (
          <List>
            {view.pages.map((page) => (
              <li key={page.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={page.staged}
                      disabled={!canWrite || pending}
                      onChange={(e) => act(() => actions.stagePage(page.id, e.target.checked))}
                      aria-label={`${w.include}: ${page.title}`}
                    />
                    <span className="text-body-strong text-ink">{page.title}</span>
                    {page.isNew && <Chip signal="neutral">{w.newPage}</Chip>}
                    {page.copy && <Chip signal="insight">{w.copyChip}</Chip>}
                  </label>
                  {!page.isNew && (
                    <Button kind="quiet" size="dense" onClick={() => setShown(shown === page.id ? null : page.id)}>
                      {shown === page.id ? w.hide : w.compare}
                    </Button>
                  )}
                  <ButtonLink kind="quiet" size="dense" href={page.editHref}>
                    {page.copy ? w.editCopy : w.edit}
                  </ButtonLink>
                </div>
                {shown === page.id && <VersionDifferences differences={page.differences} />}
                {page.liveChanged.changed && (
                  <div className="flex flex-col gap-2 rounded-panel bg-warning-soft p-3 text-sm text-warning-text" data-live-changed>
                    <p>{w.liveChanged}</p>
                    {page.liveChanged.differences.length > 0 && <VersionDifferences differences={page.liveChanged.differences} />}
                    {canWrite && (
                      <div>
                        <Button kind="quiet" size="dense" disabled={pending} onClick={() => act(() => actions.keepCopy(page.id))}>
                          {w.keepCopy}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </List>
        )}
      </Card>

      <Card title={w.themeTitle} description={w.themeHint}>
        {view.themes.length === 0 ? (
          <p className="text-sm text-muted">{w.noThemes}</p>
        ) : (
          <fieldset className="flex flex-col gap-2 text-sm" disabled={!canWrite || pending}>
            <legend className="sr-only">{w.themeTitle}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="staged-theme" checked={view.open.installId === null} onChange={() => act(() => actions.stageTheme(null))} className="size-4" />
              {w.noTheme}
            </label>
            {view.themes.map((theme) => (
              <label key={theme.id} className="flex items-start gap-2">
                <input type="radio" name="staged-theme" checked={view.open?.installId === theme.id} onChange={() => act(() => actions.stageTheme(theme.id))} className="mt-0.5 size-4" />
                <span>
                  <span className="text-ink">{theme.title}</span>
                  <span className="block text-muted">
                    {theme.areas.length === 0 ? w.sameLook : fillWords(w.lookAreas, { areas: theme.areas.map((a) => lookWords[a]).join(", ") })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Card>

      <Card title={w.menusTitle} description={w.menusHint}>
        <List>
          {view.menus.map((menu) => (
            <ListRow key={menu.id}>
              <RowLead
                title={menu.name}
                sub={
                  menu.staged
                    ? [fillWords(w.staged, { before: menu.staged.before, after: menu.staged.after }), menu.staged.renamed ? fillWords(w.renamed, { name: menu.staged.name }) : null].filter(Boolean).join(" · ")
                    : undefined
                }
              />
              {canWrite && (
                <div className="flex flex-wrap gap-1">
                  <ButtonLink kind="quiet" size="dense" href={menu.stageHref}>
                    {menu.staged ? w.editStaged : w.stageMenu}
                  </ButtonLink>
                  {menu.staged && (
                    <Button kind="quiet" size="dense" disabled={pending} onClick={() => act(() => actions.dropMenu(menu.id))}>
                      {w.dropStaged}
                    </Button>
                  )}
                </div>
              )}
            </ListRow>
          ))}
        </List>
      </Card>
    </div>
  );
}
