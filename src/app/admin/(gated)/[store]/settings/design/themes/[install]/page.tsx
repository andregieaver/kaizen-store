import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ThemeChanges } from "@/components/admin/theme-changes";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { ButtonLink, Card, Chip, List, ListRow, RowActions, RowLead, PageHeader } from "@/components/admin/ui";
import { memberCan, requirePermission } from "@/server/permissions";
import { installPreview, whatChangesFor } from "@/server/theme-preview";
import { listSavedThemes } from "@/server/themes";
import { themeCharge } from "@/server/theme-prices";
import { chargeButton, chargeLine, chargeToken } from "@/lib/theme-prices";

import { deleteSavedThemeAction, installStoreFontAction, saveSavedThemeAction, switchThemeAction } from "../../actions";
import { saveInstallCssAction, saveInstallThemeAction } from "./actions";

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
  const preview = await installPreview(store.id, installId);
  if (!preview) notFound();
  const design = `/admin/${store.slug}/settings/design`;
  if (preview.install.live) redirect(design);
  const canChange = memberCan(member, "website:write");
  const [changes, saved, charge] = await Promise.all([
    whatChangesFor(store.id, installId),
    listSavedThemes(store.id),
    // A premium theme (D286): what switching to it costs the store, said before the button that agrees to it.
    preview.install.presetId ? themeCharge(store.id, preview.install.presetId) : null,
  ]);
  const { install } = preview;
  const previewHref = `/admin/${store.slug}/settings/design/themes/${install.id}/preview`;
  const layouts = [
    { name: "Header", page: preview.header, href: preview.header && `/admin/${store.slug}/headers/${preview.header.id}` },
    { name: "Footer", page: preview.footer, href: preview.footer && `/admin/${store.slug}/footers/${preview.footer.id}` },
    { name: "Product page", page: preview.productLayout, href: preview.productLayout && `/admin/${store.slug}/product-layouts/${preview.productLayout.id}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: design, label: "Design" }}
        title={`Customise “${install.title}”`}
        status={<Chip signal="neutral">Installed, not live</Chip>}
        meta={[install.version !== null ? `Version ${install.version}` : null]}
        description="Make this theme ready before you switch to it. Visitors keep seeing your live theme until you switch, and switching never changes your words, pictures, videos, links or menus."
        actions={
          <ButtonLink href={previewHref} target="_blank" kind="main" size="header">
            Preview on your pages
          </ButtonLink>
        }
      />
      {added && (
        <p role="status" className="rounded-panel border border-line bg-card p-4 text-sm">
          “{install.title}” is in your theme library, not live: visitors see nothing of it until you switch. Preview it on your own pages,
          change it here if you like, then switch when it is ready.
        </p>
      )}
      {canChange && (
        <Card title="Switch to it" description="Makes this theme live at once. Your live theme stays in your library with every change you made to it, so you can switch back." compact>
          {charge && chargeLine(charge) && <p className="mb-3 text-sm text-ink">{chargeLine(charge)}</p>}
          <ActionForm action={switchThemeAction.bind(null, store.slug)}>
            <input type="hidden" name="install" value={install.id} />
            {charge?.kind === "now" && <input type="hidden" name="charge" value={chargeToken(charge.price)} />}
            <SubmitButton>{charge ? chargeButton(charge, `Switch to “${install.title}”`) : `Switch to “${install.title}”`}</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {changes && <ThemeChanges live={changes.live} target={changes.target} changes={changes.changes} />}
      <Card title="Its layouts" description="The header, footer and product page this theme uses. They are pages of your store: editing one changes it in this theme only, unless your live theme uses it too." compact>
        <List label="Layouts">
          {layouts.map((layout) => (
            <ListRow key={layout.name}>
              <RowLead title={layout.name} sub={layout.page ? `“${layout.page.title}”` : "The standard one"} />
              {canChange && layout.href && (
                <RowActions>
                  <ButtonLink href={layout.href}>Edit<span className="sr-only"> the {layout.name.toLowerCase()}</span></ButtonLink>
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
          <Card title="Its own CSS" description="CSS for the whole site, used only while this theme is live. Your live theme keeps its own." compact>
            <ActionForm action={saveInstallCssAction.bind(null, store.slug, install.id)} className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="sr-only">CSS</span>
                <textarea name="css" rows={10} defaultValue={preview.css} spellCheck={false} className="rounded-lg border border-line bg-card px-3 py-2 font-mono text-sm" />
              </label>
              <div>
                <SubmitButton>Save CSS</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </>
      ) : (
        <p className="text-body text-ink-2">You may look at this theme and its preview; changing it needs permission to change the website.</p>
      )}
    </div>
  );
}
