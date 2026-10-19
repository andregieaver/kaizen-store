import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import { themeStorePageHref } from "@/lib/theme-admin-paths";
import type { ThemeStorePageState } from "@/server/platform-roles";

import { createThemeStorePageAction } from "../pages/actions";

const STATE_WORDS = {
  published: { words: "Live", signal: "positive" },
  changed: { words: "Live, with changes not published", signal: "warning" },
  draft: { words: "Not published: the standard page shows", signal: "neutral" },
} as const;

/**
 * The theme store's own pages on Themes (D285): the list at `/themes` and the page drawn for every theme at `/themes/{theme}`, each built in
 * Kaizena Flow's page builder around the theme store's components, kept apart from its other pages. Until one is made and published, the
 * standard page shows; *Build it in the page builder* starts from a page that looks like it.
 */
export function ThemeStorePagesCard({ states }: { states: ThemeStorePageState[] }) {
  return (
    <div id="theme-store-pages" className="scroll-mt-4">
      <Card
        title="The theme store's pages"
        description="The list of themes and the page each theme has, built in the page builder like Kaizena Flow's other pages: words, pictures and sections of your own around the themes, which stay up to date by themselves. Each is a draft until you publish it; until then, and after Unpublish, the standard page shows."
      >
        <List label="The theme store's pages">
          {states.map(({ role, page }) => {
            const copy = PLATFORM_ROLE_COPY[role];
            const state = page ? STATE_WORDS[page.state] : null;
            return (
              <ListRow key={role}>
                <RowLead
                  title={copy.name}
                  href={page ? themeStorePageHref(page.id) : undefined}
                  sub={`${copy.address} · ${page ? `edited ${page.updatedAt.slice(0, 10)}` : `${copy.standard} shows`}`}
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
                        Edit<span className="sr-only"> {copy.name.toLowerCase()}</span>
                      </ButtonLink>
                      <a
                        href={`${themeStorePageHref(page.id)}/preview`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm underline underline-offset-2"
                      >
                        Preview<span className="sr-only"> {copy.name.toLowerCase()} (opens in a new window)</span>
                      </a>
                    </>
                  ) : (
                    <ActionForm action={createThemeStorePageAction.bind(null, role) as never}>
                      <SubmitButton variant="secondary">
                        Build it in the page builder<span className="sr-only"> for {copy.name.toLowerCase()}</span>
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
