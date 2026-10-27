import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ThemeChanges } from "@/components/admin/theme-changes";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead, PageHeader } from "@/components/admin/ui";
import { memberCan, requirePermission } from "@/server/permissions";
import { installPreview, whatChangesFor } from "@/server/theme-preview";
import { listSavedThemes } from "@/server/themes";
import { themeCharge } from "@/server/theme-prices";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { chargeButton, chargeLine, chargeToken } from "@/lib/theme-prices";

import { deleteSavedThemeAction, installStoreFontAction, saveSavedThemeAction, switchThemeAction } from "../../actions";
import {
  cancelThemeScheduleAction,
  listInstallLinksAction,
  makeInstallLinkAction,
  revokeInstallLinkAction,
  saveInstallCssAction,
  saveInstallThemeAction,
  scheduleThemeAction,
} from "./actions";
import { ShareLinks } from "@/components/admin/share-links";
import { ThemeScheduleCard } from "@/components/admin/theme-schedule-card";
import { themeFactsFor, themeScheduleOf } from "@/server/theme-schedules";

export const metadata: Metadata = { title: "Customise theme" };

/**
 * One installed theme that is not live, made ready before the store switches to it (D244, `docs/theme-phase-2.md` step 3): its preview on the
 * store's own pages, what switching changes, its settings (the same editor as the live theme's, saved into the install) and its own CSS.
 * Visitors see none of it until the owner switches. The live theme is edited on Design settings, so its address goes there.
 */
export default async function CustomiseThemePage({ params, searchParams }: PageProps<"/admin/[store]/settings/design/themes/[install]">) {
  const { store: slug, install: installId } = await params;
  const added = (await searchParams).added === "1";
  const member = await requirePermission(slug, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "design");
  const w = all.install;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const preview = await installPreview(store.id, installId);
  if (!preview) notFound();
  const design = `/admin/${store.slug}/settings/design`;
  if (preview.install.live) redirect(design);
  const canChange = memberCan(member, "website:write");
  const [changes, saved, charge, planned] = await Promise.all([
    whatChangesFor(store.id, installId, all.changes),
    listSavedThemes(store.id),
    // A premium theme (D286): what switching to it costs the store, said before the button that agrees to it.
    preview.install.presetId ? themeCharge(store.id, preview.install.presetId) : null,
    // What is planned for this theme, or did not happen (D340).
    themeScheduleOf(store.id),
  ]);
  const { install } = preview;
  const previewHref = `/admin/${store.slug}/settings/design/themes/${install.id}/preview`;
  const layouts = [
    { name: w.layouts.header, page: preview.header, href: preview.header && `/admin/${store.slug}/headers/${preview.header.id}` },
    { name: w.layouts.footer, page: preview.footer, href: preview.footer && `/admin/${store.slug}/footers/${preview.footer.id}` },
    { name: w.layouts.productLayout, page: preview.productLayout, href: preview.productLayout && `/admin/${store.slug}/product-layouts/${preview.productLayout.id}` },
  ];
  const switchName = fillWords(w.switchTo, { name: install.title });

  return (
    <AdminTextScope texts={adminTexts(lang, ["design", "schedules"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: design, label: w.back }}
        title={fillWords(w.title, { name: install.title })}
        status={<Chip signal="neutral">{w.notLive}</Chip>}
        meta={[install.version !== null ? fillWords(all.common.version, { n: install.version }) : null]}
        description={w.description}
        actions={
          <ButtonLink href={previewHref} target="_blank" kind="main" size="header">
            {w.previewOnPages}
          </ButtonLink>
        }
      />
      {added && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          {fillWords(w.added, { name: install.title })}
        </p>
      )}
      {canChange && (
        <Card title={w.switchTitle} description={w.switchDescription} compact>
          {charge && chargeLine(charge, all.charge, locale) && <p className="mb-3 text-sm text-ink">{chargeLine(charge, all.charge, locale)}</p>}
          <ActionForm action={switchThemeAction.bind(null, store.slug)}>
            <input type="hidden" name="install" value={install.id} />
            {charge?.kind === "now" && <input type="hidden" name="charge" value={chargeToken(charge.price)} />}
            <SubmitButton>{charge ? chargeButton(charge, switchName, all.charge, locale) : switchName}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {/* Live at a set time, and the theme before back at another (D340); never for a theme that costs money the store has not agreed to. */}
      {canChange && (
        <ThemeScheduleCard
          zone={store.timeZone}
          facts={themeFactsFor(planned, install.id)}
          schedule={scheduleThemeAction.bind(null, store.slug, install.id)}
          cancel={cancelThemeScheduleAction.bind(null, store.slug)}
          lang={lang}
        />
      )}
      {/* Links that show the store's pages in this theme without signing in (D340). */}
      {canChange && (
        <Card title={adminText(lang, "schedules").share.title} compact>
          <ShareLinks
            id={install.id}
            noun="theme"
            actions={{
              list: listInstallLinksAction.bind(null, store.slug),
              make: makeInstallLinkAction.bind(null, store.slug),
              revoke: revokeInstallLinkAction.bind(null, store.slug),
            }}
          />
        </Card>
      )}
      {changes && <ThemeChanges live={changes.live} target={changes.target} changes={changes.changes} lang={lang} />}
      <Card title={w.layoutsTitle} description={w.layoutsDescription} compact>
        <List label={w.layoutsLabel}>
          {layouts.map((layout) => (
            <ListRow key={layout.name}>
              <RowLead title={layout.name} sub={layout.page ? fillWords(all.common.quote, { title: layout.page.title }) : w.standard} />
              {canChange && layout.href && (
                <RowActions>
                  <ButtonLink href={layout.href}>{all.common.edit}<span className="sr-only"> {fillWords(w.editThe, { name: layout.name.toLowerCase() })}</span></ButtonLink>
                </RowActions>
              )}
            </ListRow>
          ))}
        </List>
      </Card>
      {canChange ? (
        <>
          <ThemeEditor
            installed={install.title}
            storeName={store.name}
            current={preview.theme}
            saved={saved}
            logos={{ logo: store.navigation.logo !== null, dark: store.navigation.logoDark !== null }}
            actions={{
              save: saveInstallThemeAction.bind(null, store.slug, install.id),
              saveSaved: saveSavedThemeAction.bind(null, store.slug),
              removeSaved: deleteSavedThemeAction.bind(null, store.slug),
              installFont: installStoreFontAction.bind(null, store.slug),
            }}
          />
          <Card title={w.cssTitle} description={w.cssDescription} compact>
            <ActionForm action={saveInstallCssAction.bind(null, store.slug, install.id)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="sr-only">CSS</span>
                <textarea name="css" rows={10} defaultValue={preview.css} spellCheck={false} className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm" />
              </label>
              <div>
                <SubmitButton>{w.saveCss}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </>
      ) : (
        <p className="text-body text-ink-2">{w.lookOnly}</p>
      )}
    </div>
    </AdminTextScope>
  );
}
