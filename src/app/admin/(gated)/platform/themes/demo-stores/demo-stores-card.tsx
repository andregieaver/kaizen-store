import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge } from "@/components/admin/lifecycle-buttons";
import { AllPackPictures, PackPictures, PackPicturesWatch } from "@/components/admin/pack-pictures";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import type { StarterRow } from "@/lib/store-starters";
import { demoStoreHref } from "@/lib/theme-admin-paths";
import type { PackState } from "@/server/content-packs";
import { starterLifecycle } from "@/server/store-starters";
import { fillWords } from "@/lib/admin-fill";
import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

import { askPackPicturesAction, publishStarterAction, stopPackPicturesAction, syncContentPacksAction } from "./actions";

/** What a demo store's row says about it, in one short phrase. */
type PackStatus = keyof PlatformSiteMessages["starting"]["status"];

function packStatus(pack: PackState): { key: PackStatus; signal: "positive" | "warning" | "neutral" } {
  if (!pack.starterId) return { key: "notSetUp", signal: "neutral" };
  if (pack.archived) return { key: "archived", signal: "neutral" };
  if (!pack.current) return { key: "newer", signal: "warning" };
  if (pack.pictures < pack.slots) return pack.asked ? { key: "making", signal: "neutral" } : { key: "toMake", signal: "warning" };
  return pack.published ? { key: "published", signal: "positive" } : { key: "ready", signal: "positive" };
}

/**
 * The starting content on the Themes page (D275, the content packs of D257): pages, products and photographs Kaizena Flow writes in code,
 * one per trade. Each launch theme has one as its own content, and a new theme's content is a copy of one. One press sets them up or brings
 * them up to date, each then needs its pictures (made by the job in the background, D271) and is published here with one press. `older`
 * are demo stores made by hand before D273, kept for the stores and requests that name them.
 */
export function DemoStoresCard({ packs, older, contentOf, w }: { packs: PackState[]; older: StarterRow[]; contentOf: Record<string, string>; w: PlatformSiteMessages }) {
  const t = w.starting;
  const toSetUp = packs.filter((pack) => !pack.archived && (!pack.starterId || !pack.current)).length;
  const fresh = packs.every((pack) => !pack.starterId);
  // Demo stores whose pictures can be asked for: set up, current, not archived, some missing and not asked for already.
  const ready = (pack: PackState) => pack.starterId !== null && pack.current && !pack.archived;
  const toAsk = packs.filter((pack) => ready(pack) && pack.pictures < pack.slots && !pack.asked).map((pack) => pack.key);
  return (
    <div id="starting-content" className="scroll-mt-4">
      <Card
        title={t.title}
        description={t.description}
        aside={
          toSetUp > 0 ? (
            <ActionForm action={syncContentPacksAction}>
              <SubmitButton>{fresh ? t.setUp : t.upToDate}</SubmitButton>
            </ActionForm>
          ) : toAsk.length > 1 ? (
            <AllPackPictures ask={askPackPicturesAction.bind(null, toAsk)} />
          ) : undefined
        }
      >
        <PackPicturesWatch active={packs.some((pack) => ready(pack) && pack.asked && pack.pictures < pack.slots)} />
        <List label={t.title}>
          {packs.map((pack) => {
            const status = packStatus(pack);
            const theme = contentOf[pack.key];
            const sub = [pack.slug ? `${pack.storeName} · /s/${pack.slug}` : pack.storeName, theme ? fillWords(t.themeContent, { theme }) : t.noThemeContent].join(" · ");
            return (
              <ListRow key={pack.key}>
                <RowLead title={pack.title} href={pack.starterId ? demoStoreHref(pack.starterId) : undefined} sub={sub} />
                <Chip signal={status.signal} dot>
                  {t.status[status.key]}
                </Chip>
                <RowActions>
                  {ready(pack) && (
                    <PackPictures
                      title={pack.title}
                      made={pack.pictures}
                      total={pack.slots}
                      asked={pack.asked}
                      problem={pack.problem}
                      ask={askPackPicturesAction.bind(null, [pack.key])}
                      stop={stopPackPicturesAction.bind(null, pack.key)}
                    />
                  )}
                  {status.key === "ready" && pack.starterId && (
                    <ActionForm action={publishStarterAction.bind(null, pack.starterId)}>
                      <SubmitButton>
                        {t.publish}
                        <span className="sr-only"> {pack.title}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                </RowActions>
              </ListRow>
            );
          })}
        </List>
        {older.length > 0 && (
          <div className="mt-6 flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{t.older}</h3>
            <p className="text-sm text-muted">{t.olderNote}</p>
            <List label={t.older}>
              {older.map((starter) => (
                <ListRow key={starter.id}>
                  <RowLead title={starter.title} href={demoStoreHref(starter.id)} sub={`/s/${starter.storeSlug}`} />
                  <LifecycleBadge facts={starterLifecycle(starter)} words={w.lifecycle} />
                </ListRow>
              ))}
            </List>
          </div>
        )}
      </Card>
    </div>
  );
}
