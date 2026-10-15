import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DesignProfilePanel } from "@/components/admin/design-profile-panel";
import { ThemeFollow } from "@/components/admin/theme-follow";
import { ThemeUpdates } from "@/components/admin/theme-updates";
import { ThemeLibrary } from "@/components/admin/theme-library";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { designPreviewPath } from "@/lib/design-presets";
import { THEME_UPDATE_KEEP_DAYS, latestDesignUse, listOfferedDesigns, themeUpdates } from "@/server/design-presets";
import { memberCan, requirePermission } from "@/server/permissions";
import { THEME_DETACH_KEEP_DAYS, listDetachRuns } from "@/server/theme-detach";
import { listInstalls } from "@/server/theme-installs";
import { listSavedThemes } from "@/server/themes";
import { Card, PageHeader } from "@/components/admin/ui";

import {
  applyDesignAction,
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
} from "./actions";

export const metadata: Metadata = { title: "Design" };

/** The store's theme (D60): colours, fonts, buttons, corners, layout and product cards. */
export default async function StoreDesignPage({ params, searchParams }: PageProps<"/admin/[store]/settings/design">) {
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  const [saved, designs, latest, installs, runs] = await Promise.all([listSavedThemes(store.id), listOfferedDesigns(), latestDesignUse(store.id), listInstalls(store.id), listDetachRuns(store.id)]);
  const updates = await themeUpdates(store.id);
  // Design profiles (D176): applied by those who may change the website.
  const canChange = memberCan(member, "website:write");
  // A new store whose chosen design profile could not be applied lands here (`createStoreAction`).
  const designFailed = (await searchParams).design === "failed";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Design"
        description={<>How your store looks: the themes installed in it, one of them live, and the live theme&apos;s settings. Pages you build use it too.</>}
      />
      {designFailed && (
        <p role="alert" className="max-w-3xl rounded-panel border border-line bg-card p-4 text-sm">
          The store is made, but the theme you chose could not be applied: it has its store template&apos;s look. Add the theme below,
          or choose another.
        </p>
      )}
      <ThemeLibrary
        installs={installs}
        base={`/admin/${store.slug}/settings/design`}
        switchTo={canChange ? switchThemeAction.bind(null, store.slug) : null}
        remove={canChange ? removeThemeAction.bind(null, store.slug) : null}
      />
      <ThemeUpdates
        available={updates.available}
        made={updates.made}
        installs={updates.installs}
        keepDays={THEME_UPDATE_KEEP_DAYS}
        update={canChange ? updateThemeAction.bind(null, store.slug) : null}
        undo={canChange ? undoThemeUpdateAction.bind(null, store.slug) : null}
        follow={canChange ? followUpdatesAction.bind(null, store.slug) : null}
      />
      <ThemeFollow
        runs={runs}
        keepDays={THEME_DETACH_KEEP_DAYS}
        count={canChange ? countThemeFollowAction.bind(null, store.slug) : null}
        run={canChange ? runThemeFollowAction.bind(null, store.slug) : null}
        undo={canChange ? undoThemeFollowAction.bind(null, store.slug) : null}
      />
      <DesignProfilePanel
        designs={designs.map((d) => ({ ...d, previewHref: designPreviewPath(d.id) }))}
        latest={latest}
        apply={canChange ? applyDesignAction.bind(null, store.slug) : null}
        restore={canChange ? restoreDesignAction.bind(null, store.slug) : null}
        canChange={canChange}
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
        }}
      />
      <Card title="Cart" className="max-w-3xl" compact>
        <p className="mb-4 text-sm text-muted">On phones, the cart slides out over the page. Larger screens show it as a page.</p>
        <ActionForm action={saveCartBehaviourAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="openCartOnAdd" defaultChecked={store.openCartOnAdd} className="mt-0.5 size-4" />
            <span>
              Open the cart when something is added
              <span className="block text-muted">
                On phones, the cart slides out as soon as a shopper adds a product, instead of a short message under the
                button.
              </span>
            </span>
          </label>
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
