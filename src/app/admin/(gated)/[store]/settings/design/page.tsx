import type { Metadata } from "next";

import { ThemeEditor } from "@/components/admin/theme-editor";
import { requireMember } from "@/server/auth";
import { listSavedThemes } from "@/server/themes";

import { deleteSavedThemeAction, installStoreFontAction, saveSavedThemeAction, saveThemeAction } from "./actions";

export const metadata: Metadata = { title: "Design" };

/** The store's theme (D60): colours, fonts, buttons, corners, layout and product cards. */
export default async function StoreDesignPage({ params }: PageProps<"/admin/[store]/settings/design">) {
  const { store } = await requireMember((await params).store);
  const saved = await listSavedThemes(store.id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Design</h1>
        <p className="max-w-2xl text-sm text-muted">
          How your store looks: choose a theme, change any of its settings, and save your own versions to switch between.
          Pages you build use it too.
        </p>
      </div>
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
        }}
      />
    </div>
  );
}
