import { ButtonLink, Card, Chip, List, ListRow, RowLead } from "@/components/admin/ui";
import { NEW_DEMO_STORE, demoStoreHref } from "@/lib/theme-admin-paths";
import type { DemoStore } from "@/server/demo-stores";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

/** "Calm · Coast", or "its own look" for a demo store that wears no theme. */
export function wearsWords(wears: DemoStore["wears"], ownLook: string = platformSiteEn.demo.ownLook): string {
  if (!wears) return ownLook;
  return wears.presetName ? `${wears.title} · ${wears.presetName}` : wears.title;
}

/**
 * The demo stores on the Themes page (D277, `docs/themes-content-and-demo-stores.md` section 4): live stores made by a platform admin, each
 * wearing a theme customised in its own store admin, listed under *See it live* on that theme's page once published. *New demo store* is
 * the one main action.
 */
export function LiveDemoStoresCard({ demos, w }: { demos: DemoStore[]; w: PlatformSiteMessages }) {
  const l = w.live;
  return (
    <div id="demo-stores" className="scroll-mt-4">
      <Card
        title={l.title}
        description={l.description}
        aside={
          <ButtonLink href={NEW_DEMO_STORE} kind="strong">
            {l.new}
          </ButtonLink>
        }
      >
        {demos.length === 0 ? (
          <p className="text-sm text-muted">{l.none}</p>
        ) : (
          <List label={l.title}>
            {demos.map((demo) => (
              <ListRow key={demo.id}>
                <RowLead title={demo.storeName} href={demoStoreHref(demo.id)} sub={fillWords(l.wears, { look: wearsWords(demo.wears, w.demo.ownLook), slug: demo.storeSlug })} />
                <Chip signal={demo.published ? "positive" : "neutral"} dot>
                  {demo.published ? l.live : l.notPublished}
                </Chip>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
