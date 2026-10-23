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
import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn, type PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";

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
  w = platformSiteEn,
}: {
  demo: DemoStore;
  /** Whether its look can be a preset of the theme it wears, and why not. */
  preset: { ok: true } | { ok: false; problems: string[] };
  /** Just made, but its theme could not be applied. */
  unthemed: boolean;
  w?: PlatformSiteMessages;
}) {
  const d = w.demo;
  const facts = { published: demo.published, archivedAt: demo.archivedAt, publishedAt: demo.publishedAt, changed: false, used: false };
  const wears = demo.wears;
  const archived = demo.archivedAt !== null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: DEMO_STORES_HREF, label: d.back }}
        title={demo.storeName}
        status={<LifecycleBadge facts={facts} words={w.lifecycle} />}
        meta={[
          fillWords(d.wears, { look: wearsWords(wears, d.ownLook) }),
          demo.published ? fillWords(d.liveAt, { address: demo.address }) : fillWords(d.itsStore, { slug: demo.storeSlug }),
          demo.publishedAt && fillWords(d.published, { date: demo.publishedAt.slice(0, 10) }),
        ]}
      />

      {unthemed && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {d.unthemed}
        </p>
      )}

      <Card title={d.live} className="flex flex-col gap-3" compact>
        <ul className="list-disc pl-5 text-sm text-muted">
          <li>{d.liveCustomise}</li>
          <li>{d.livePublish}</li>
          <li>{d.liveNoOrders}</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={openStarterAdminAction.bind(null, demo.id)}>
            <SubmitButton>{d.openAdmin}</SubmitButton>
          </ActionForm>
          <a href={demo.address} target="_blank" rel="noopener" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-3 text-sm hover:bg-sunken">
            {d.openStore}
            <span className="sr-only">
              {" "}
              {demo.storeName} {w.preview.opensNew}
            </span>
          </a>
          <LifecycleButtons
            kind="demo store"
            title={demo.storeName}
            facts={facts}
            words={w.lifecycle}
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

      <Card title={d.onThemePage} description={d.onThemePageDescription} className="flex flex-col gap-3" compact>
        <ActionForm action={saveDemoDetailsAction.bind(null, demo.id)} className="flex max-w-3xl flex-col gap-3">
          <label className={field}>
            {d.trade} <span className="font-normal text-muted">{d.tradeHint}</span>
            <input name="trade" defaultValue={demo.summary} maxLength={200} className={control} />
          </label>
          <label className={field}>
            {d.picture} <span className="font-normal text-muted">{d.pictureHint}</span>
            <input name="pictureUrl" defaultValue={demo.pictureUrl ?? ""} maxLength={2000} className={control} />
          </label>
          <div>
            <SubmitButton variant="secondary">{d.save}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {!archived && (
        <Card
          title={d.publishLook}
          description={d.publishLookDescription}
          className="flex flex-col gap-5"
          compact
        >
          <section aria-labelledby="as-theme" className="flex flex-col gap-2">
            <h3 id="as-theme" className="text-body-strong text-ink">
              {d.asTheme}
            </h3>
            <p className="text-sm text-muted">{d.asThemeDescription}</p>
            <ActionForm action={demoAsThemeAction.bind(null, demo.id)} className="flex max-w-xl flex-wrap items-end gap-2">
              <label className={`${field} min-w-56 flex-1`}>
                {d.themeName}
                <input name="title" required maxLength={80} defaultValue={demo.storeName} className={control} />
              </label>
              <SubmitButton variant="secondary">{d.makeTheme}</SubmitButton>
            </ActionForm>
          </section>

          <section aria-labelledby="as-preset" className="flex flex-col gap-2">
            <h3 id="as-preset" className="text-body-strong text-ink">
              {wears ? fillWords(d.asPresetOf, { theme: wears.title }) : d.asPreset}
            </h3>
            {preset.ok && wears ? (
              <>
                <p className="text-sm text-muted">{fillWords(d.asPresetDescription, { theme: wears.title })}</p>
                <ActionForm action={demoAsPresetAction.bind(null, demo.id)} className="flex max-w-xl flex-wrap items-end gap-2">
                  <label className={`${field} min-w-56 flex-1`}>
                    {d.presetName}
                    <input name="name" required maxLength={40} defaultValue={demo.storeName.slice(0, 40)} className={control} />
                  </label>
                  <SubmitButton variant="secondary">{d.addPreset}</SubmitButton>
                </ActionForm>
              </>
            ) : (
              <p className="text-sm">{preset.ok ? d.wearsNone : preset.problems.join(" ")}</p>
            )}
          </section>

          <section aria-labelledby="next-version" className="flex flex-col gap-2">
            <h3 id="next-version" className="text-body-strong text-ink">
              {wears ? fillWords(d.intoNext, { theme: wears.title }) : d.intoNextAny}
            </h3>
            {wears && !wears.archived ? (
              <>
                <p className="text-sm text-muted">{fillWords(d.intoNextDescription, { theme: wears.title })}</p>
                <ActionForm action={demoIntoNextVersionAction.bind(null, demo.id)} className="flex flex-col gap-2">
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="confirm" className="mt-1" />
                    <span>{fillWords(d.intoNextConfirm, { theme: wears.title })}</span>
                  </label>
                  <div>
                    <SubmitButton variant="secondary">{d.replace}</SubmitButton>
                  </div>
                </ActionForm>
              </>
            ) : (
              <p className="text-sm">{wears ? fillWords(d.archived, { theme: wears.title }) : d.wearsNone}</p>
            )}
          </section>
        </Card>
      )}
    </div>
  );
}
