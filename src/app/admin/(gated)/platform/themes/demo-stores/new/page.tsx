import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignCards } from "@/components/admin/design-cards";
import { Card, PageHeader } from "@/components/admin/ui";
import { demoStoreAddress } from "@/lib/demo-stores";
import { CONTENT_SOURCE_WORDS } from "@/lib/store-starters";
import { DEMO_STORES_HREF } from "@/lib/theme-admin-paths";
import { requirePlatformAdmin } from "@/server/auth";
import { demoContentChoices } from "@/server/demo-stores";
import { designChoices } from "@/server/design-presets";

import { createDemoStoreAction } from "../demo-actions";

export const metadata: Metadata = { title: "New demo store" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/**
 * *New demo store* (D277, `docs/themes-content-and-demo-stores.md` section 4): its name, its address (a store's, which real stores share),
 * the theme or preset it wears and the content it starts with. *Make the demo store* makes it and opens its store admin.
 */
export default async function NewDemoStorePage() {
  await connection();
  await requirePlatformAdmin();
  const [designs, contents] = await Promise.all([designChoices(), demoContentChoices()]);
  // Any published theme or preset; the Standard card is a new store's, not a look to wear.
  const cards = designs.cards.filter((card) => card.id !== "");
  const example = demoStoreAddress("your-address");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: DEMO_STORES_HREF, label: "Themes" }}
        title="New demo store"
        description="A live store wearing a theme, made from starting content. You customise it in its own store admin like any store, then publish it."
      />
      <Card title="The demo store" className="flex max-w-3xl flex-col gap-3" compact>
        {cards.length === 0 || contents.length === 0 ? (
          <p className="text-sm text-muted">
            {cards.length === 0 ? "Publish a theme first: a demo store wears one." : "Publish some starting content first: a demo store starts as a copy of it."}
          </p>
        ) : (
          <ActionForm action={createDemoStoreAction} className="flex flex-col gap-4">
            <label className={field}>
              Name
              <input name="name" required maxLength={80} className={control} />
            </label>
            <label className={field}>
              Address
              <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" aria-describedby="demo-slug-hint" className={control} />
              <span id="demo-slug-hint" className="font-normal text-muted">
                Lowercase letters, digits and hyphens, not taken by any store: real stores share these addresses. It will be at {example}.
              </span>
            </label>
            <DesignCards cards={cards} legend="Theme it wears" hint="Any published theme, or one of its presets. Preview opens it in a new window." startsWith={false} selected={cards[0]?.id ?? ""} />
            <label className={field}>
              Content to start with <span className="font-normal text-muted">(its pages, products and pictures, a copy it can change)</span>
              <select name="content" defaultValue={contents.find((c) => c.kind === "pack")?.id ?? contents[0]?.id} className={control}>
                {contents.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({CONTENT_SOURCE_WORDS[source.kind]})
                  </option>
                ))}
              </select>
            </label>
            <div>
              <SubmitButton>Make the demo store</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
