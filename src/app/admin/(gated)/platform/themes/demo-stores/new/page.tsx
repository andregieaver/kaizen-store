import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignCards } from "@/components/admin/design-cards";
import { Card, PageHeader } from "@/components/admin/ui";
import { demoStoreAddress } from "@/lib/demo-stores";
import { DEMO_STORES_HREF } from "@/lib/theme-admin-paths";
import { requirePlatformAdmin } from "@/server/auth";
import { demoContentChoices } from "@/server/demo-stores";
import { designChoices } from "@/server/design-presets";

import { createDemoStoreAction } from "../demo-actions";
import { fillWords } from "@/lib/admin-fill";
import { platformText } from "@/lib/platform-text";
import { platformSiteWords } from "@/server/platform-site-words";

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
  const { lang, w } = await platformSiteWords();
  const n = w.newDemo;
  const [designs, contents] = await Promise.all([designChoices(), demoContentChoices()]);
  // Any published theme or preset; the Standard card is a new store's, not a look to wear.
  const cards = designs.cards.filter((card) => card.id !== "");
  const example = demoStoreAddress("your-address");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: DEMO_STORES_HREF, label: n.back }}
        title={n.title}
        description={n.description}
      />
      <Card title={n.card} className="flex max-w-3xl flex-col gap-3" compact>
        {cards.length === 0 || contents.length === 0 ? (
          <p className="text-sm text-muted">
            {cards.length === 0 ? n.noTheme : n.noContent}
          </p>
        ) : (
          <ActionForm action={createDemoStoreAction} className="flex flex-col gap-4">
            <label className={field}>
              {n.name}
              <input name="name" required maxLength={80} className={control} />
            </label>
            <label className={field}>
              {n.address}
              <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,38}[a-z0-9]" aria-describedby="demo-slug-hint" className={control} />
              <span id="demo-slug-hint" className="font-normal text-muted">
                {fillWords(n.addressHint, { example })}
              </span>
            </label>
            <DesignCards
              cards={cards}
              legend={n.wears}
              hint={n.wearsHint}
              startsWith={false}
              selected={cards[0]?.id ?? ""}
              words={platformText(lang).themeCards}
            />
            <label className={field}>
              {n.content} <span className="font-normal text-muted">{n.contentHint}</span>
              <select name="content" defaultValue={contents.find((c) => c.kind === "pack")?.id ?? contents[0]?.id} className={control}>
                {contents.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} ({w.contentSources[source.kind]})
                  </option>
                ))}
              </select>
            </label>
            <div>
              <SubmitButton>{n.make}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
