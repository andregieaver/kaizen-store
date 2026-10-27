import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ThemeChanges } from "@/components/admin/theme-changes";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/server/auth";
import { getPlatformChrome } from "@/server/platform-navigation";
import { platformInstallPreview, whatChangesForPlatform } from "@/server/platform-theme-preview";

import { installPlatformFontAction } from "../../fonts/actions";
import { switchPlatformThemeAction } from "../actions";
import { savePlatformInstallCssAction, savePlatformInstallThemeAction } from "./actions";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Customise theme" };

/**
 * One theme installed on Kaizena Flow's own site that is not live, made ready before the site switches to it (D252, `docs/theme-phase-4.md`
 * step 2), as a store's is (D244): its preview on Kaizena Flow's own pages, what switching changes, its settings (the same editor, saved into
 * the install) and its own CSS. Visitors see none of it until the switch; the live theme is edited where it always was.
 */
export default async function CustomisePlatformThemePage({ params }: PageProps<"/admin/platform/site-design/[install]">) {
  await connection();
  await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const d = w.siteDesign;
  const { install: installId } = await params;
  const preview = await platformInstallPreview(installId);
  if (!preview) notFound();
  if (preview.install.live) redirect("/admin/platform/site-design");
  const [changes, chrome] = await Promise.all([whatChangesForPlatform(installId, adminText(lang, "design").changes), getPlatformChrome()]);
  const { install } = preview;
  const layouts = [
    { name: d.header, page: preview.header, href: preview.header && `/admin/platform/headers/${preview.header.id}` },
    { name: d.footer, page: preview.footer, href: preview.footer && `/admin/platform/footers/${preview.footer.id}` },
  ];

  return (
    <AdminTextScope texts={adminTexts(lang, ["design", "platformSite"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/site-design", label: d.title }}
        title={fillWords(d.customiseTitle, { title: install.title })}
        status={<Chip signal="neutral">{d.notLive}</Chip>}
        meta={[install.version !== null ? fillWords(d.version, { version: install.version }) : null]}
        description={d.customiseDescription}
        actions={
          <ButtonLink href={`/admin/platform/site-design/${install.id}/preview`} target="_blank" kind="main" size="header">
            {d.previewPages}
          </ButtonLink>
        }
      />
      <Card title={d.switchTitle} description={d.switchDescription} compact>
        <ActionForm action={switchPlatformThemeAction}>
          <input type="hidden" name="install" value={install.id} />
          <SubmitButton>{fillWords(d.switchTo, { title: install.title })}</SubmitButton>
        </ActionForm>
      </Card>
      {changes && <ThemeChanges live={changes.live} target={changes.target} changes={changes.changes} lang={lang} />}
      <Card title={d.layouts} description={d.layoutsDescription} compact>
        <List label={d.layoutsList}>
          {layouts.map((layout) => (
            <ListRow key={layout.name}>
              <RowLead title={layout.name} sub={layout.page ? `“${layout.page.title}”` : d.standardOne} />
              {layout.href && (
                <RowActions>
                  <ButtonLink href={layout.href}>
                    {w.themes.edit}
                    <span className="sr-only"> {fillWords(d.editThe, { name: layout.name.toLowerCase() })}</span>
                  </ButtonLink>
                </RowActions>
              )}
            </ListRow>
          ))}
        </List>
      </Card>
      <ThemeEditor
        installed={install.title}
        storeName="Kaizena Flow"
        checkout={false}
        current={preview.theme}
        saved={[]}
        logos={{ logo: chrome.navigation.logo !== null, dark: chrome.navigation.logoDark !== null }}
        actions={{ save: savePlatformInstallThemeAction.bind(null, install.id), installFont: installPlatformFontAction }}
      />
      <Card title={d.cssTitle} description={d.cssDescription} compact>
        <ActionForm action={savePlatformInstallCssAction.bind(null, install.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="sr-only">CSS</span>
            <textarea name="css" rows={10} defaultValue={preview.css} spellCheck={false} className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm" />
          </label>
          <div>
            <SubmitButton>{d.saveCss}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
    </AdminTextScope>
  );
}
