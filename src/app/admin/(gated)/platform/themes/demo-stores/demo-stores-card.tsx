import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge } from "@/components/admin/lifecycle-buttons";
import { AllPackPictures, PackPictures, PackPicturesWatch } from "@/components/admin/pack-pictures";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import type { StarterRow } from "@/lib/store-starters";
import { demoStoreHref } from "@/lib/theme-admin-paths";
import type { PackState } from "@/server/content-packs";
import { starterLifecycle } from "@/server/store-starters";

import { askPackPicturesAction, publishStarterAction, stopPackPicturesAction, syncContentPacksAction } from "./actions";

/** What a demo store's row says about it, in one short phrase. */
function packStatus(pack: PackState): { words: string; signal: "positive" | "warning" | "neutral" } {
  if (!pack.starterId) return { words: "Not set up", signal: "neutral" };
  if (pack.archived) return { words: "Archived", signal: "neutral" };
  if (!pack.current) return { words: "Newer version to set up", signal: "warning" };
  if (pack.pictures < pack.slots) return pack.asked ? { words: "Making pictures", signal: "neutral" } : { words: "Pictures to make", signal: "warning" };
  return pack.published ? { words: "Published", signal: "positive" } : { words: "Ready to publish", signal: "positive" };
}

/**
 * The starting content on the Themes page (D275, the content packs of D257): pages, products and photographs Kaizena Flow writes in code,
 * one per trade. Each launch theme has one as its own content, and a new theme's content is a copy of one. One press sets them up or brings
 * them up to date, each then needs its pictures (made by the job in the background, D271) and is published here with one press. `older`
 * are demo stores made by hand before D273, kept for the stores and requests that name them.
 */
export function DemoStoresCard({ packs, older, contentOf }: { packs: PackState[]; older: StarterRow[]; contentOf: Record<string, string> }) {
  const toSetUp = packs.filter((pack) => !pack.archived && (!pack.starterId || !pack.current)).length;
  const fresh = packs.every((pack) => !pack.starterId);
  // Demo stores whose pictures can be asked for: set up, current, not archived, some missing and not asked for already.
  const ready = (pack: PackState) => pack.starterId !== null && pack.current && !pack.archived;
  const toAsk = packs.filter((pack) => ready(pack) && pack.pictures < pack.slots && !pack.asked).map((pack) => pack.key);
  return (
    <div id="starting-content" className="scroll-mt-4">
      <Card
        title="Starting content"
        description="Pages, products and photographs Kaizena Flow writes in English, one set per trade. Each of Kaizena Flow's themes has one as its own content, which its preview shows and a new store started from it begins with; a new theme's content starts as a copy of one. Set them up, make their pictures (made in the background, so you can leave the page), then publish each."
        aside={
          toSetUp > 0 ? (
            <ActionForm action={syncContentPacksAction}>
              <SubmitButton>{fresh ? "Set up the starting content" : "Bring it up to date"}</SubmitButton>
            </ActionForm>
          ) : toAsk.length > 1 ? (
            <AllPackPictures ask={askPackPicturesAction.bind(null, toAsk)} />
          ) : undefined
        }
      >
        <PackPicturesWatch active={packs.some((pack) => ready(pack) && pack.asked && pack.pictures < pack.slots)} />
        <List label="Starting content">
          {packs.map((pack) => {
            const status = packStatus(pack);
            const theme = contentOf[pack.key];
            const sub = [pack.slug ? `${pack.storeName} · /s/${pack.slug}` : pack.storeName, theme ? `${theme}'s content` : "no theme's own content"].join(" · ");
            return (
              <ListRow key={pack.key}>
                <RowLead title={pack.title} href={pack.starterId ? demoStoreHref(pack.starterId) : undefined} sub={sub} />
                <Chip signal={status.signal} dot>
                  {status.words}
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
                  {status.words === "Ready to publish" && pack.starterId && (
                    <ActionForm action={publishStarterAction.bind(null, pack.starterId)}>
                      <SubmitButton>
                        Publish<span className="sr-only"> {pack.title}</span>
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
            <h3 className="text-body-strong text-ink">Older starting content</h3>
            <p className="text-sm text-muted">Starting content made by hand before themes had their own. No look starts from it; open one to archive or delete it.</p>
            <List label="Older starting content">
              {older.map((starter) => (
                <ListRow key={starter.id}>
                  <RowLead title={starter.title} href={demoStoreHref(starter.id)} sub={`/s/${starter.storeSlug}`} />
                  <LifecycleBadge facts={starterLifecycle(starter)} />
                </ListRow>
              ))}
            </List>
          </div>
        )}
      </Card>
    </div>
  );
}
