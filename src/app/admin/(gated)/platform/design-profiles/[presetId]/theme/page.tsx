import type { Metadata } from "next";

import { ThemeEditor } from "@/components/admin/theme-editor";
import { listSavedThemes } from "@/server/themes";

import { designWorkspacePage } from "../data";
import { DesignShell } from "../shell";
import { installWorkspaceFontAction, removeWorkspaceSavedThemeAction, saveWorkspaceSavedThemeAction, saveWorkspaceThemeAction } from "../workspace-actions";

export const metadata: Metadata = { title: "Design profile theme" };

/** A design profile's theme (D177): the store theme editor (D60) on the profile's workspace; saved as the profile's draft. */
export default async function DesignThemePage({ params }: PageProps<"/admin/platform/design-profiles/[presetId]/theme">) {
  const page = await designWorkspacePage((await params).presetId);
  return (
    <DesignShell design={page.design} facts={page.facts} tab="theme">
      {page.problem !== null ? (
        <p role="alert" className="rounded-lg border border-border bg-background p-4 text-sm">{page.problem}</p>
      ) : (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Colours, fonts, buttons, corners, layout, product cards, light and dark. Save puts it in the profile&apos;s draft; stores get it
            when the profile is published. Saved versions stay with the profile.
          </p>
          <ThemeEditor
            key={JSON.stringify(page.store.theme)}
            storeName={page.store.name}
            current={page.store.theme}
            saved={await listSavedThemes(page.store.id)}
            logos={{ logo: page.store.navigation.logo !== null, dark: page.store.navigation.logoDark !== null }}
            actions={{
              save: saveWorkspaceThemeAction.bind(null, page.workspace.presetId),
              saveSaved: saveWorkspaceSavedThemeAction.bind(null, page.workspace.presetId),
              removeSaved: removeWorkspaceSavedThemeAction.bind(null, page.workspace.presetId),
              installFont: installWorkspaceFontAction.bind(null, page.workspace.presetId),
            }}
          />
        </>
      )}
    </DesignShell>
  );
}
