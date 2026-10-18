import { ButtonLink, Card, Chip, List, ListRow, RowLead } from "@/components/admin/ui";
import { NEW_DEMO_STORE, demoStoreHref } from "@/lib/theme-admin-paths";
import type { DemoStore } from "@/server/demo-stores";

/** "Calm · Coast", or "its own look" for a demo store that wears no theme. */
export function wearsWords(wears: DemoStore["wears"]): string {
  if (!wears) return "its own look";
  return wears.presetName ? `${wears.title} · ${wears.presetName}` : wears.title;
}

/**
 * The demo stores on the Themes page (D277, `docs/themes-content-and-demo-stores.md` section 4): live stores made by a platform admin, each
 * wearing a theme customised in its own store admin, listed under *See it live* on that theme's page once published. *New demo store* is
 * the one main action.
 */
export function LiveDemoStoresCard({ demos }: { demos: DemoStore[] }) {
  return (
    <div id="demo-stores" className="scroll-mt-4">
      <Card
        title="Demo stores"
        description="Live stores you dress in a theme and customise like any store. Published, each shows under See it live on the page of the theme it wears, and its look can become a new theme, a preset or a theme's next version. They take no orders and send no emails to shoppers."
        aside={
          <ButtonLink href={NEW_DEMO_STORE} kind="strong">
            New demo store
          </ButtonLink>
        }
      >
        {demos.length === 0 ? (
          <p className="text-sm text-muted">No demo stores yet.</p>
        ) : (
          <List label="Demo stores">
            {demos.map((demo) => (
              <ListRow key={demo.id}>
                <RowLead title={demo.storeName} href={demoStoreHref(demo.id)} sub={`Wears ${wearsWords(demo.wears)} · /s/${demo.storeSlug}`} />
                <Chip signal={demo.published ? "positive" : "neutral"} dot>
                  {demo.published ? "Live" : "Not published"}
                </Chip>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
