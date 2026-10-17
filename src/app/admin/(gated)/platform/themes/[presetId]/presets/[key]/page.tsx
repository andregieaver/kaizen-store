import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PreviewLink } from "@/components/admin/preview-link";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { ButtonLink, Card } from "@/components/admin/ui";
import { designPreviewPath, designTabHref } from "@/lib/design-presets";
import { variationForEdit } from "@/server/design-variations";

import { designWorkspacePage } from "../../data";
import { DesignShell } from "../../shell";
import { installVariationFontAction, renameVariationAction, saveVariationThemeAction } from "../../variation-actions";

export const metadata: Metadata = { title: "Theme preset" };

/**
 * One of a theme's presets (`docs/theme-showcase-phase-1.md` step 1): its name and its look in the store theme editor (D60), saved into the
 * theme's draft; the theme's header, footer, product page and CSS are shared by all its presets.
 */
export default async function DesignPresetPage({ params }: PageProps<"/admin/platform/themes/[presetId]/presets/[key]">) {
  const { presetId, key } = await params;
  const page = await designWorkspacePage(presetId);
  const preset = await variationForEdit(page.admin, presetId, key);
  if (!preset) notFound();
  return (
    <DesignShell design={page.design} facts={page.facts} tab="presets">
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink href={designTabHref(presetId, "presets")} kind="link">
          All presets
        </ButtonLink>
        <PreviewLink href={designPreviewPath(presetId, null, true, true, false, preset.key)} label="Preview the draft" title={preset.name} />
      </div>
      <Card title={preset.name} description={`Its address is ${preset.key}, which stays when it is renamed.`}>
        <ActionForm action={renameVariationAction.bind(null, presetId, preset.key)} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input name="name" required maxLength={40} defaultValue={preset.name} className="input min-h-10 w-64 rounded-lg border border-edge px-3" />
          </label>
          <SubmitButton variant="secondary">Rename</SubmitButton>
        </ActionForm>
      </Card>
      {page.problem !== null ? (
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm">{page.problem}</p>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Colours, fonts, buttons, corners, layout, product cards, light and dark, and section styles for this preset. Save puts it in the
            theme&apos;s draft; stores get it when the theme is published.
          </p>
          <ThemeEditor
            key={JSON.stringify(preset.storeTheme)}
            storeName={page.store.name}
            current={preset.storeTheme}
            saved={[]}
            logos={{ logo: page.store.navigation.logo !== null, dark: page.store.navigation.logoDark !== null }}
            actions={{
              save: saveVariationThemeAction.bind(null, presetId, preset.key),
              installFont: installVariationFontAction,
            }}
          />
        </>
      )}
    </DesignShell>
  );
}
