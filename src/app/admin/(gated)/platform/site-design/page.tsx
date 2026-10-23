import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/server/auth";
import { ThemeUpdates } from "@/components/admin/theme-updates";
import { THEME_UPDATE_KEEP_DAYS, listOfferedDesigns, platformThemeUpdates } from "@/server/design-presets";
import { listPlatformInstalls } from "@/server/platform-theme-installs";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminTexts } from "@/lib/admin-text";
import { platformSiteWords } from "@/server/platform-site-words";

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
  const { lang, w } = await platformSiteWords();
  const d = w.siteDesign;
  const [installs, offered, updates] = await Promise.all([listPlatformInstalls(), listOfferedDesigns(), platformThemeUpdates()]);
  const installed = new Set(installs.map((install) => install.presetId).filter(Boolean));
  return (
    <AdminTextScope texts={adminTexts(lang, ["design", "platformSite"])}>
      <PageHeader title={d.title} description={d.description} />
      <Card title={d.installed}>
        <List label={d.installedList}>
          {installs.map((install) => (
            <ListRow key={install.id}>
              <RowLead
                title={install.title}
                sub={
                  <>
                    {install.live && <Chip signal="positive">{d.live}</Chip>}
                    {install.version !== null && <span className="ml-2">{fillWords(d.version, { version: install.version })}</span>}
                    <span className="ml-2">{fillWords(d.added, { date: install.installedAt.slice(0, 10) })}</span>
                  </>
                }
              />
              {!install.live && (
                <RowActions>
                  <ButtonLink href={`/admin/platform/site-design/${install.id}`}>
                    {d.customise}
                    <span className="sr-only"> {install.title}</span>
                  </ButtonLink>
                  <ActionForm action={switchPlatformThemeAction}>
                    <input type="hidden" name="install" value={install.id} />
                    <SubmitButton>
                      {d.switch}
                      <span className="sr-only"> ({install.title})</span>
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={removePlatformThemeAction}>
                    <input type="hidden" name="install" value={install.id} />
                    <SubmitButton variant="secondary">
                      {d.remove}
                      <span className="sr-only"> {install.title}</span>
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
        description={fillWords(d.updates, { days: THEME_UPDATE_KEEP_DAYS })}
        lang={lang}
      />
      <Card title={d.addTitle} description={d.addDescription}>
        {offered.length === 0 ? (
          <p className="text-sm text-muted">{d.noneOffered}</p>
        ) : (
          <List label={d.offeredList}>
            {/* Each theme's own look, then each of its presets (docs/theme-showcase-phase-1.md), added on its own. */}
            {offered.flatMap((design) => [null, ...(design.presets ?? [])].map((preset) => {
              const name = preset ? `${design.title} · ${preset.name}` : design.title;
              return (
                <ListRow key={`${design.id}:${preset?.key ?? ""}`}>
                  <RowLead
                    title={name}
                    sub={!preset && installed.has(design.id) ? <Chip>{d.installedChip}</Chip> : preset ? fillWords(d.presetOf, { theme: design.title }) : design.summary || undefined}
                  />
                  <RowActions>
                    <ActionForm action={addPlatformThemeAction}>
                      <input type="hidden" name="design" value={design.id} />
                      {preset && <input type="hidden" name="preset" value={preset.key} />}
                      <SubmitButton variant="secondary">
                        {!preset && installed.has(design.id) ? d.addCopy : d.add}
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
    </AdminTextScope>
  );
}
