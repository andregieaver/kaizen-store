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

export const metadata: Metadata = { title: "Customise theme" };

/**
 * One theme installed on Kaizena Flow's own site that is not live, made ready before the site switches to it (D252, `docs/theme-phase-4.md`
 * step 2), as a store's is (D244): its preview on Kaizena Flow's own pages, what switching changes, its settings (the same editor, saved into
 * the install) and its own CSS. Visitors see none of it until the switch; the live theme is edited where it always was.
 */
export default async function CustomisePlatformThemePage({ params }: PageProps<"/admin/platform/site-design/[install]">) {
  await connection();
  await requirePlatformAdmin();
  const { install: installId } = await params;
  const preview = await platformInstallPreview(installId);
  if (!preview) notFound();
  if (preview.install.live) redirect("/admin/platform/site-design");
  const [changes, chrome] = await Promise.all([whatChangesForPlatform(installId), getPlatformChrome()]);
  const { install } = preview;
  const layouts = [
    { name: "Header", page: preview.header, href: preview.header && `/admin/platform/headers/${preview.header.id}` },
    { name: "Footer", page: preview.footer, href: preview.footer && `/admin/platform/footers/${preview.footer.id}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/site-design", label: "Themes" }}
        title={`Customise “${install.title}”`}
        status={<Chip signal="neutral">Installed, not live</Chip>}
        meta={[install.version !== null ? `Version ${install.version}` : null]}
        description="Make this theme ready before Kaizena Flow's site switches to it. Visitors keep seeing the live theme until then, and switching never changes a page, article, menu, word or picture."
        actions={
          <ButtonLink href={`/admin/platform/site-design/${install.id}/preview`} target="_blank" kind="main" size="header">
            Preview on Kaizena Flow&apos;s pages
          </ButtonLink>
        }
      />
      <Card title="Switch to it" description="Makes this theme live on Kaizena Flow's site at once. The live theme stays in the library with every change made to it, so you can switch back." compact>
        <ActionForm action={switchPlatformThemeAction}>
          <input type="hidden" name="install" value={install.id} />
          <SubmitButton>Switch to “{install.title}”</SubmitButton>
        </ActionForm>
      </Card>
      {changes && <ThemeChanges live={changes.live} target={changes.target} changes={changes.changes} />}
      <Card title="Its layouts" description="The header and footer this theme uses. They are Kaizena Flow's pages: editing one changes it in this theme only, unless the live theme uses it too." compact>
        <List label="Layouts">
          {layouts.map((layout) => (
            <ListRow key={layout.name}>
              <RowLead title={layout.name} sub={layout.page ? `“${layout.page.title}”` : "The standard one"} />
              {layout.href && (
                <RowActions>
                  <ButtonLink href={layout.href}>
                    Edit<span className="sr-only"> the {layout.name.toLowerCase()}</span>
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
        current={preview.theme}
        saved={[]}
        logos={{ logo: chrome.navigation.logo !== null, dark: chrome.navigation.logoDark !== null }}
        actions={{ save: savePlatformInstallThemeAction.bind(null, install.id), installFont: installPlatformFontAction }}
      />
      <Card title="Its own CSS" description="CSS for the whole of Kaizena Flow's site, used only while this theme is live. The live theme keeps its own." compact>
        <ActionForm action={savePlatformInstallCssAction.bind(null, install.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="sr-only">CSS</span>
            <textarea name="css" rows={10} defaultValue={preview.css} spellCheck={false} className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm" />
          </label>
          <div>
            <SubmitButton>Save CSS</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
