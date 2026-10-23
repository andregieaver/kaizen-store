import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { themeStorePageHref } from "@/lib/theme-admin-paths";
import type { ThemeStorePageState } from "@/server/platform-roles";
import { fillWords } from "@/lib/admin-fill";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

import { createThemeStorePageAction } from "../pages/actions";

const STATE_SIGNALS = { published: "positive", changed: "warning", draft: "neutral" } as const;

/**
 * The theme store's own pages on Themes (D285): the list at `/themes` and the page drawn for every theme at `/themes/{theme}`, each built in
 * Kaizena Flow's page builder around the theme store's components, kept apart from its other pages. Until one is made and published, the
 * standard page shows; *Build it in the page builder* starts from a page that looks like it.
 */
export function ThemeStorePagesCard({ states, w }: { states: ThemeStorePageState[]; w: PlatformSiteMessages }) {
  const p = w.storePages;
  return (
    <div id="theme-store-pages" className="scroll-mt-4">
      <Card
        title={p.title}
        description={p.description}
      >
        <List label={p.title}>
          {states.map(({ role, page }) => {
            const copy = { ...PLATFORM_ROLE_COPY[role], ...w.tables.roles[role] };
            const state = page ? { words: p.states[page.state], signal: STATE_SIGNALS[page.state] } : null;
            return (
              <ListRow key={role}>
                <RowLead
                  title={copy.name}
                  href={page ? themeStorePageHref(page.id) : undefined}
                  sub={`${copy.address} · ${page ? fillWords(p.edited, { date: page.updatedAt.slice(0, 10) }) : fillWords(p.shows, { standard: copy.standard })}`}
                />
                {state && (
                  <Chip signal={state.signal} dot>
                    {state.words}
                  </Chip>
                )}
                <RowActions>
                  {page ? (
                    <>
                      <ButtonLink href={themeStorePageHref(page.id)}>
                        {p.edit}
                        <span className="sr-only"> {copy.name.toLowerCase()}</span>
                      </ButtonLink>
                      <a
                        href={`${themeStorePageHref(page.id)}/preview`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm underline underline-offset-2"
                      >
                        {p.preview}
                        <span className="sr-only">
                          {" "}
                          {copy.name.toLowerCase()} {w.preview.opensNew}
                        </span>
                      </a>
                    </>
                  ) : (
                    <ActionForm action={createThemeStorePageAction.bind(null, role) as never}>
                      <SubmitButton variant="secondary">
                        {p.build}
                        <span className="sr-only"> {fillWords(p.buildFor, { name: copy.name.toLowerCase() })}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                </RowActions>
              </ListRow>
            );
          })}
        </List>
      </Card>
    </div>
  );
}
