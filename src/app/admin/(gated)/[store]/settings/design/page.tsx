import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DesignProfilePanel } from "@/components/admin/design-profile-panel";
import { ThemeFollow } from "@/components/admin/theme-follow";
import { ThemeUpdates } from "@/components/admin/theme-updates";
import { ThemeLibrary } from "@/components/admin/theme-library";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { scheduleChip } from "@/lib/page-schedules";
import { themeFactsFor, themeScheduleOf } from "@/server/theme-schedules";
import { adminText, adminTexts } from "@/lib/admin-text";
import { designPreviewPath } from "@/lib/design-presets";
import { THEME_UPDATE_KEEP_DAYS, latestDesignUse, listOfferedDesigns, themeUpdates } from "@/server/design-presets";
import { memberCan, requirePermission } from "@/server/permissions";
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
  const [saved, designs, latest, installs, runs] = await Promise.all([listSavedThemes(store.id), listOfferedDesigns(), latestDesignUse(store.id), listInstalls(store.id), listDetachRuns(store.id)]);
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
  return (
    <AdminTextScope texts={adminTexts(lang, ["design", "schedules"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      {designFailed && (
        <p role="alert" className="max-w-3xl rounded-panel border border-line bg-card p-4 text-sm">
          {w.designFailed}
        </p>
      )}
      <ThemeLibrary
        installs={installs.map((install) => ({ ...install, charge: install.presetId ? charges.get(install.presetId) : undefined }))}
        base={`/admin/${store.slug}/settings/design`}
        switchTo={canChange ? switchThemeAction.bind(null, store.slug) : null}
        remove={canChange ? removeThemeAction.bind(null, store.slug) : null}
        schedules={schedules}
        lang={lang}
      />
      <ThemeUpdates
        available={updates.available}
        made={updates.made}
        installs={updates.installs}
        keepDays={THEME_UPDATE_KEEP_DAYS}
        update={canChange ? updateThemeAction.bind(null, store.slug) : null}
        undo={canChange ? undoThemeUpdateAction.bind(null, store.slug) : null}
        follow={canChange ? followUpdatesAction.bind(null, store.slug) : null}
        lang={lang}
      />
      <ThemeFollow
        runs={runs}
        keepDays={THEME_DETACH_KEEP_DAYS}
        count={canChange ? countThemeFollowAction.bind(null, store.slug) : null}
        run={canChange ? runThemeFollowAction.bind(null, store.slug) : null}
        undo={canChange ? undoThemeFollowAction.bind(null, store.slug) : null}
        lang={lang}
      />
      <DesignProfilePanel
        designs={designs.map((d) => ({ ...d, previewHref: designPreviewPath(d.id), charge: charges.get(d.id) }))}
        latest={latest}
        apply={canChange ? applyDesignAction.bind(null, store.slug) : null}
        install={canChange ? installThemeAction.bind(null, store.slug) : null}
        restore={canChange ? restoreDesignAction.bind(null, store.slug) : null}
        canChange={canChange}
        lang={lang}
      />
      <ThemeEditor
        // A theme applied, switched to or put back changes the settings under the editor: it starts again from the store's.
        key={JSON.stringify(store.theme)}
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
          ...(canChange && { versions: { list: lookVersionsAction.bind(null, store.slug), read: lookVersionAction.bind(null, store.slug) } }),
        }}
      />
      {/* Themes from outside (D344): the live look sent to Kaizena Flow to review, by those who may change it, from a real store. */}
      {canChange && !store.isTemplate && !store.starter && (
        <Card title={all.share.card} className="max-w-3xl" compact>
          <p className="mb-4 text-sm text-muted">{all.share.cardHint}</p>
          <ButtonLink href={`/admin/${store.slug}/settings/design/share`}>{all.share.open}</ButtonLink>
        </Card>
      )}
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
    </div>
    </AdminTextScope>
  );
}
