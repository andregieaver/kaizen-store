import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/server/auth";
import { listOfferedDesigns } from "@/server/design-presets";
import { listPlatformInstalls } from "@/server/platform-theme-installs";

import { addPlatformThemeAction, removePlatformThemeAction, switchPlatformThemeAction } from "./actions";

export const metadata: Metadata = { title: "Themes for Kaizena Flow's site" };

/**
 * Kaizena Flow's own theme library (`docs/theme-phase-4.md` step 1): the themes installed on its site, the live one first, with *Switch to
 * it* and *Remove*, and the published themes to add. Switching changes only the look (theme, fonts, CSS, header and footer); pages, articles,
 * menus, words and pictures stay.
 */
export default async function PlatformThemesPage() {
  await connection();
  await requirePlatformAdmin();
  const [installs, offered] = await Promise.all([listPlatformInstalls(), listOfferedDesigns()]);
  const installed = new Set(installs.map((install) => install.presetId).filter(Boolean));
  return (
    <>
      <PageHeader
        title="Themes"
        description="The looks installed on Kaizena Flow's own site: one is live. Switching changes the colours, fonts, buttons, header, footer and the site's CSS at once; every page, article, menu, word and picture stays. The look you switch away from is kept here with every change made to it."
      />
      <Card title="Installed on Kaizena Flow's site">
        <List label="Installed themes">
          {installs.map((install) => (
            <ListRow key={install.id}>
              <RowLead
                title={install.title}
                sub={
                  <>
                    {install.live && <Chip signal="positive">Live</Chip>}
                    {install.version !== null && <span className="ml-2">Version {install.version}</span>}
                    <span className="ml-2">Added {install.installedAt.slice(0, 10)}</span>
                  </>
                }
              />
              {!install.live && (
                <RowActions>
                  <ButtonLink href={`/admin/platform/themes/${install.id}`}>
                    Preview and customise<span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                  <ActionForm action={switchPlatformThemeAction}>
                    <input type="hidden" name="install" value={install.id} />
                    <SubmitButton>
                      Switch to it<span className="sr-only"> ({install.title})</span>
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={removePlatformThemeAction}>
                    <input type="hidden" name="install" value={install.id} />
                    <SubmitButton variant="secondary">
                      Remove<span className="sr-only"> {install.title}</span>
                    </SubmitButton>
                  </ActionForm>
                </RowActions>
              )}
            </ListRow>
          ))}
        </List>
      </Card>
      <Card title="Add a theme" description="A published theme is added without going live: its header and footer become Kaizena Flow's pages and its pictures are copied into Kaizena Flow's media library. A theme's product page is for stores and is left out.">
        {offered.length === 0 ? (
          <p className="text-sm text-muted">No theme is published yet.</p>
        ) : (
          <List label="Published themes">
            {offered.map((design) => (
              <ListRow key={design.id}>
                <RowLead title={design.title} sub={installed.has(design.id) ? <Chip>Installed</Chip> : design.summary || undefined} />
                <RowActions>
                  <ActionForm action={addPlatformThemeAction}>
                    <input type="hidden" name="design" value={design.id} />
                    <SubmitButton variant="secondary">
                      {installed.has(design.id) ? "Add another copy" : "Add"}
                      <span className="sr-only"> ({design.title})</span>
                    </SubmitButton>
                  </ActionForm>
                </RowActions>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </>
  );
}
