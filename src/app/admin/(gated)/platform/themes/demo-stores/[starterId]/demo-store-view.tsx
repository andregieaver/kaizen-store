import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { LifecycleBadge, LifecycleButtons } from "@/components/admin/lifecycle-buttons";
import { Card, PageHeader } from "@/components/admin/ui";
import { DEMO_STORES_HREF } from "@/lib/theme-admin-paths";
import type { DemoStore } from "@/server/demo-stores";

import { openStarterAdminAction } from "../actions";
import {
  archiveDemoStoreAction,
  deleteDemoStoreAction,
  demoAsPresetAction,
  demoAsThemeAction,
  demoIntoNextVersionAction,
  publishDemoStoreAction,
  restoreDemoStoreAction,
  saveDemoDetailsAction,
  unpublishDemoStoreAction,
} from "../demo-actions";
import { wearsWords } from "../live-demo-stores-card";

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const field = "flex flex-col gap-1 text-sm font-medium";

/**
 * One demo store (D277, `docs/themes-content-and-demo-stores.md` section 4): live as it stands once published (no copy kept), customised
 * in its own store admin, with its trade and picture for *See it live* and *Publish this look…*: a new theme, a preset of the theme it
 * wears (when only its theme settings differ, `presetCheck()`), or that theme's next version, each a copy made once.
 */
export function DemoStoreView({
  demo,
  preset,
  unthemed,
}: {
  demo: DemoStore;
  /** Whether its look can be a preset of the theme it wears, and why not. */
  preset: { ok: true } | { ok: false; problems: string[] };
  /** Just made, but its theme could not be applied. */
  unthemed: boolean;
}) {
  const facts = { published: demo.published, archivedAt: demo.archivedAt, publishedAt: demo.publishedAt, changed: false, used: false };
  const wears = demo.wears;
  const archived = demo.archivedAt !== null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: DEMO_STORES_HREF, label: "Themes" }}
        title={demo.storeName}
        status={<LifecycleBadge facts={facts} />}
        meta={[`Wears ${wearsWords(wears)}`, demo.published ? `Live at ${demo.address}` : `Its store is /s/${demo.storeSlug}`, demo.publishedAt && `Published ${demo.publishedAt.slice(0, 10)}`]}
      />

      {unthemed && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          The demo store is made, but its theme could not be applied. Open its admin and choose the theme in its Design settings.
        </p>
      )}

      <Card title="Live" className="flex flex-col gap-3" compact>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>Customise it in its own admin like any store: its Design settings, pages, products and pictures.</li>
          <li>Publish puts it live: every change shows at once, and the page of the theme it wears lists it under See it live. Unpublish takes it off.</li>
          <li>It takes no orders, sends no emails to shoppers and is never shown to search engines.</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={openStarterAdminAction.bind(null, demo.id)}>
            <SubmitButton>Open its admin</SubmitButton>
          </ActionForm>
          <a href={demo.address} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-3 text-sm hover:bg-sunken">
            Open the store<span className="sr-only"> {demo.storeName} (opens in a new window)</span>
          </a>
          <LifecycleButtons
            kind="demo store"
            title={demo.storeName}
            facts={facts}
            actions={{
              publish: publishDemoStoreAction.bind(null, demo.id),
              unpublish: unpublishDemoStoreAction.bind(null, demo.id),
              archive: archiveDemoStoreAction.bind(null, demo.id),
              restore: restoreDemoStoreAction.bind(null, demo.id),
              remove: deleteDemoStoreAction.bind(null, demo.id),
            }}
          />
        </div>
      </Card>

      <Card title="On the theme's page" description="What See it live shows beside its name and the look it wears." className="flex flex-col gap-3" compact>
        <ActionForm action={saveDemoDetailsAction.bind(null, demo.id)} className="flex max-w-3xl flex-col gap-3">
          <label className={field}>
            Its trade <span className="font-normal text-muted">(one line, such as “Linen and home goods”)</span>
            <input name="trade" defaultValue={demo.summary} maxLength={200} className={control} />
          </label>
          <label className={field}>
            Picture <span className="font-normal text-muted">(an address from the media library; empty: the look&apos;s colours)</span>
            <input name="pictureUrl" defaultValue={demo.pictureUrl ?? ""} maxLength={2000} className={control} />
          </label>
          <div>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {!archived && (
        <Card
          title="Publish this look…"
          description="A copy made once, when you press: the demo store and the theme never stay linked, so what you try here reaches no store using the theme."
          className="flex flex-col gap-5"
          compact
        >
          <section aria-labelledby="as-theme" className="flex flex-col gap-2">
            <h3 id="as-theme" className="text-body-strong text-ink">
              As a new theme
            </h3>
            <p className="text-sm text-muted">
              Its look (theme settings, header, footer, product page and CSS) and a copy of its content, as a new theme that opens unpublished,
              to set up and publish like any theme.
            </p>
            <ActionForm action={demoAsThemeAction.bind(null, demo.id)} className="flex max-w-xl flex-wrap items-end gap-2">
              <label className={`${field} min-w-56 flex-1`}>
                The theme&apos;s name
                <input name="title" required maxLength={80} defaultValue={demo.storeName} className={control} />
              </label>
              <SubmitButton variant="secondary">Make the theme</SubmitButton>
            </ActionForm>
          </section>

          <section aria-labelledby="as-preset" className="flex flex-col gap-2">
            <h3 id="as-preset" className="text-body-strong text-ink">
              {wears ? `As a preset of ${wears.title}` : "As a preset"}
            </h3>
            {preset.ok && wears ? (
              <>
                <p className="text-sm text-muted">
                  Its theme settings (colours, fonts, buttons and the rest) as a new preset of {wears.title}, a draft until {wears.title} is
                  published.
                </p>
                <ActionForm action={demoAsPresetAction.bind(null, demo.id)} className="flex max-w-xl flex-wrap items-end gap-2">
                  <label className={`${field} min-w-56 flex-1`}>
                    The preset&apos;s name
                    <input name="name" required maxLength={40} defaultValue={demo.storeName.slice(0, 40)} className={control} />
                  </label>
                  <SubmitButton variant="secondary">Add the preset</SubmitButton>
                </ActionForm>
              </>
            ) : (
              <p className="text-sm">{preset.ok ? "It wears no theme." : preset.problems.join(" ")}</p>
            )}
          </section>

          <section aria-labelledby="next-version" className="flex flex-col gap-2">
            <h3 id="next-version" className="text-body-strong text-ink">
              {wears ? `Into ${wears.title}'s next version` : "Into a theme's next version"}
            </h3>
            {wears && !wears.archived ? (
              <>
                <p className="text-sm text-muted">
                  Its look replaces the draft look of {wears.title}. You review it, write What&apos;s new and publish; stores that follow updates
                  get it only then.
                </p>
                <ActionForm action={demoIntoNextVersionAction.bind(null, demo.id)} className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm" className="mt-1" />
                    <span>Replace {wears.title}&apos;s draft look with this demo store&apos;s.</span>
                  </label>
                  <div>
                    <SubmitButton variant="secondary">Replace the draft look</SubmitButton>
                  </div>
                </ActionForm>
              </>
            ) : (
              <p className="text-sm">{wears ? `${wears.title} is archived.` : "It wears no theme."}</p>
            )}
          </section>
        </Card>
      )}
    </div>
  );
}
