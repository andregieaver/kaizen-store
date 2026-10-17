import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/server/auth";
import { ThemeUpdates } from "@/components/admin/theme-updates";
import { THEME_UPDATE_KEEP_DAYS, listOfferedDesigns, platformThemeUpdates } from "@/server/design-presets";
import { listPlatformInstalls } from "@/server/platform-theme-installs";

import {
  addPlatformThemeAction,
  followPlatformUpdatesAction,
  removePlatformThemeAction,
  switchPlatformThemeAction,
  undoPlatformThemeUpdateAction,
  updatePlatformThemeAction,
} from "./actions";

export const metadata: Metadata = { title: "Themes for Kaizena Flow's site" };

/**
 * Kaizena Flow's own theme library (`docs/theme-phase-4.md` step 1): the themes installed on its site, the live one first, with *Switch to
 * it* and *Remove*, and the published themes to add. Switching changes only the look (theme, fonts, CSS, header and footer); pages, articles,
 * menus, words and pictures stay.
 */
export default async function PlatformThemesPage() {
  await connection();
  await requirePlatformAdmin();
  const [installs, offered, updates] = await Promise.all([listPlatformInstalls(), listOfferedDesigns(), platformThemeUpdates()]);
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
                  <ButtonLink href={`/admin/platform/site-design/${install.id}`}>
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
      <ThemeUpdates
        available={updates.available}
        made={updates.made}
        installs={updates.installs}
        keepDays={THEME_UPDATE_KEEP_DAYS}
        update={updatePlatformThemeAction}
        undo={undoPlatformThemeUpdateAction}
        follow={followPlatformUpdatesAction}
        description={`When a theme installed here gets a new version, it can update by itself or wait for you. An update keeps every change made to it on Kaizena Flow's site: its own settings, fonts and CSS stay, and a header or footer that was edited stays, with the new one added as a draft beside it. Pages, articles, menus, words and pictures are never touched. An update can be undone for ${THEME_UPDATE_KEEP_DAYS} days, as long as the theme has not changed since.`}
      />
      <Card title="Add a theme" description="A published theme is added without going live: its header and footer become Kaizena Flow's pages and its pictures are copied into Kaizena Flow's media library. A theme's product page is for stores and is left out.">
        {offered.length === 0 ? (
          <p className="text-sm text-muted">No theme is published yet.</p>
        ) : (
          <List label="Published themes">
            {/* Each theme's own look, then each of its presets (docs/theme-showcase-phase-1.md), added on its own. */}
            {offered.flatMap((design) => [null, ...(design.presets ?? [])].map((preset) => {
              const name = preset ? `${design.title} · ${preset.name}` : design.title;
              return (
                <ListRow key={`${design.id}:${preset?.key ?? ""}`}>
                  <RowLead
                    title={name}
                    sub={!preset && installed.has(design.id) ? <Chip>Installed</Chip> : preset ? `A preset of ${design.title}` : design.summary || undefined}
                  />
                  <RowActions>
                    <ActionForm action={addPlatformThemeAction}>
                      <input type="hidden" name="design" value={design.id} />
                      {preset && <input type="hidden" name="preset" value={preset.key} />}
                      <SubmitButton variant="secondary">
                        {!preset && installed.has(design.id) ? "Add another copy" : "Add"}
                        <span className="sr-only"> ({name})</span>
                      </SubmitButton>
                    </ActionForm>
                  </RowActions>
                </ListRow>
              );
            }))}
          </List>
        )}
      </Card>
    </>
  );
}
