import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DesignProfilePanel } from "@/components/admin/design-profile-panel";
import { ThemeFollow } from "@/components/admin/theme-follow";
import { ThemeUpdates } from "@/components/admin/theme-updates";
import { ThemeLibrary } from "@/components/admin/theme-library";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { scheduleChip } from "@/lib/page-schedules";
import { themeFactsFor, themeScheduleOf } from "@/server/theme-schedules";
import { adminText, adminTexts } from "@/lib/admin-text";
import { designPreviewPath } from "@/lib/design-presets";
import { THEME_UPDATE_KEEP_DAYS, latestDesignUse, listOfferedDesigns, themeUpdates } from "@/server/design-presets";
import { memberCan, requirePermission } from "@/server/permissions";
import { themeLookThumbs } from "@/server/theme-store";
import { THEME_DETACH_KEEP_DAYS, listDetachRuns } from "@/server/theme-detach";
import { listInstalls } from "@/server/theme-installs";
import { listSavedThemes } from "@/server/themes";
import { themeCharges } from "@/server/theme-prices";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";

import {
  applyDesignAction,
  installThemeAction,
  countThemeFollowAction,
  followUpdatesAction,
  deleteSavedThemeAction,
  installStoreFontAction,
  saveCartBehaviourAction,
  saveSavedThemeAction,
  saveThemeAction,
  removeThemeAction,
  restoreDesignAction,
  runThemeFollowAction,
  switchThemeAction,
  undoThemeFollowAction,
  undoThemeUpdateAction,
  updateThemeAction,
  lookVersionAction,
  lookVersionsAction,
} from "./actions";

export const metadata: Metadata = { title: "Design" };

/** The store's theme (D60): colours, fonts, buttons, corners, layout and product cards. */
export default async function StoreDesignPage({ params, searchParams }: PageProps<"/admin/[store]/settings/design">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "design");
  const w = all.page;
  const [saved, designs, latest, installs, runs, thumbs] = await Promise.all([
    listSavedThemes(store.id),
    listOfferedDesigns(),
    latestDesignUse(store.id),
    listInstalls(store.id),
    listDetachRuns(store.id),
    themeLookThumbs(),
  ]);
  // What making each theme live costs this store (D286): free, already the store's, or its price, now or when the store opens.
  // What is planned for the store's themes and what did not happen (D340), on the store's clock.
  const clock = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const chips = adminText(lang, "schedules").chips;
  const planned = await themeScheduleOf(store.id);
  const schedules = Object.fromEntries(
    installs.flatMap((install) => {
      const facts = themeFactsFor(planned, install.id);
      const chip = facts && scheduleChip(facts, { ...chips, publishes: chips.themeLive }, (iso) => clock.format(new Date(iso)));
      return chip ? [[install.id, chip] as const] : [];
    }),
  );
  const [updates, charges] = await Promise.all([
    themeUpdates(store.id, { whatsNew: { ...all.whatsNew }, preset: all.presetLine }),
    themeCharges(store.id, [...designs.map((d) => d.id), ...installs.flatMap((i) => (i.presetId ? [i.presetId] : []))]),
  ]);
  // Design profiles (D176): applied by those who may change the website.
  const canChange = memberCan(member, "website:write");
  // A new store whose chosen design profile could not be applied lands here (`createStoreAction`).
  const designFailed = (await searchParams).design === "failed";
  // Round 26 (D699): on a phone the live theme comes first, then its settings as rows, then the rest of the page as rows.
  const p = all.phone;
  const liveInstall = installs.find((install) => install.live);
  const { light } = store.theme.settings;
  const others = installs.filter((install) => !install.live).length;
  const hasUpdates = updates.available.length > 0 || updates.made.length > 0 || updates.installs.length > 0;
  const canShare = canChange && !store.isTemplate && !store.starter;
  return (
    <AdminTextScope texts={adminTexts(lang, ["design", "designEditor", "schedules"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="max-sm:hidden">{w.description}</span>
            <span className="sm:hidden">{p.lead}</span>
          </>
        }
      />
      {designFailed && (
        <p role="alert" className="max-w-3xl rounded-panel border border-line bg-card p-4 text-sm">
          {w.designFailed}
        </p>
      )}
      <section aria-label={p.liveOnStore} className="flex flex-col gap-3 rounded-panel bg-card p-4 sm:hidden">
        <div className="grid h-14 grid-cols-4 overflow-hidden rounded-md border border-line" aria-hidden>
          {[light.background, light.surface, light.text, light.accent].map((color, i) => (
            <span key={i} style={{ backgroundColor: color }} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-body text-ink">{liveInstall?.title ?? store.name}</span>
            <span className="text-caption text-(--brand-text)">{p.liveOnStore}</span>
          </span>
          {liveInstall ? (
            <ButtonLink href={`/admin/${store.slug}/settings/design/themes/${liveInstall.id}/preview`} target="_blank">
              {all.common.preview}
            </ButtonLink>
          ) : null}
        </div>
      </section>
      <PhoneRows className="max-sm:order-2">
        <PhoneRow title={p.otherThemes} sub={countWords(others, p.installed)} change={p.change} done={p.done} flat>
          <ThemeLibrary
            timeZone={store.timeZone}
            installs={installs.map((install) => ({ ...install, charge: install.presetId ? charges.get(install.presetId) : undefined }))}
            base={`/admin/${store.slug}/settings/design`}
            switchTo={canChange ? switchThemeAction.bind(null, store.slug) : null}
            remove={canChange ? removeThemeAction.bind(null, store.slug) : null}
            schedules={schedules}
            lang={lang}
          />
        </PhoneRow>
        {hasUpdates && (
          <PhoneRow title={all.updates.title} sub={updates.available.length > 0 ? countWords(updates.available.length, p.updatesSub) : p.upToDate} change={p.change} done={p.done} flat>
            <ThemeUpdates
              timeZone={store.timeZone}
              available={updates.available}
              made={updates.made}
              installs={updates.installs}
              keepDays={THEME_UPDATE_KEEP_DAYS}
              update={canChange ? updateThemeAction.bind(null, store.slug) : null}
              undo={canChange ? undoThemeUpdateAction.bind(null, store.slug) : null}
              follow={canChange ? followUpdatesAction.bind(null, store.slug) : null}
              lang={lang}
            />
          </PhoneRow>
        )}
        <PhoneRow title={all.follow.title} sub={p.followSub} change={p.change} done={p.done} flat>
          <ThemeFollow
            timeZone={store.timeZone}
            runs={runs}
            keepDays={THEME_DETACH_KEEP_DAYS}
            count={canChange ? countThemeFollowAction.bind(null, store.slug) : null}
            run={canChange ? runThemeFollowAction.bind(null, store.slug) : null}
            undo={canChange ? undoThemeFollowAction.bind(null, store.slug) : null}
            lang={lang}
          />
        </PhoneRow>
        <PhoneRow title={p.addTheme} sub={p.addThemeSub} change={p.change} done={p.done} flat last>
          <DesignProfilePanel
            timeZone={store.timeZone}
            designs={designs.map((d) => ({ ...d, previewHref: designPreviewPath(d.id), charge: charges.get(d.id), thumbs: thumbs.get(d.id) }))}
            latest={latest}
            apply={canChange ? applyDesignAction.bind(null, store.slug) : null}
            install={canChange ? installThemeAction.bind(null, store.slug) : null}
            restore={canChange ? restoreDesignAction.bind(null, store.slug) : null}
            canChange={canChange}
            lang={lang}
          />
        </PhoneRow>
      </PhoneRows>
      <div className="max-sm:order-1">
        <ThemeEditor
          storeName={store.name}
          current={store.theme}
          saved={saved}
          logos={{ logo: store.navigation.logo !== null, dark: store.navigation.logoDark !== null }}
          actions={{
            save: saveThemeAction.bind(null, store.slug),
            saveSaved: saveSavedThemeAction.bind(null, store.slug),
            removeSaved: deleteSavedThemeAction.bind(null, store.slug),
            installFont: installStoreFontAction.bind(null, store.slug),
            // The live look's earlier versions (D340), for those who may change it.
            ...(canChange && { versions: { timeZone: store.timeZone, list: lookVersionsAction.bind(null, store.slug), read: lookVersionAction.bind(null, store.slug) } }),
          }}
        />
      </div>
      <PhoneRows className="max-sm:order-3">
        {/* Themes from outside (D344): the live look sent to Kaizena Flow to review, by those who may change it, from a real store. */}
        {canShare && (
          <PhoneRow title={all.share.card} sub={p.shareSub} change={p.change} done={p.done} flat>
            <Card title={all.share.card} className="max-w-3xl" compact>
              <p className="mb-4 text-sm text-muted">{all.share.cardHint}</p>
              <ButtonLink href={`/admin/${store.slug}/settings/design/share`}>{all.share.open}</ButtonLink>
            </Card>
          </PhoneRow>
        )}
        <PhoneRow title={w.cart} sub={store.openCartOnAdd ? p.cartSub.on : p.cartSub.off} change={p.change} done={p.done} flat last>
          <Card title={w.cart} className="max-w-3xl" compact>
            <p className="mb-4 text-sm text-muted">{w.cartHint}</p>
            <ActionForm action={saveCartBehaviourAction.bind(null, store.slug)} className="flex flex-col gap-4">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="openCartOnAdd" defaultChecked={store.openCartOnAdd} className="mt-0.5 size-4" />
                <span>
                  {w.openCart}
                  <span className="block text-muted">{w.openCartHint}</span>
                </span>
              </label>
              <div>
                <SubmitButton>{all.common.save}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </PhoneRow>
      </PhoneRows>
    </div>
    </AdminTextScope>
  );
}
