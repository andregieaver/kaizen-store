import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ThemeEditor } from "@/components/admin/theme-editor";
import { requireMember } from "@/server/auth";
import { listSavedThemes } from "@/server/themes";

import {
  deleteSavedThemeAction,
  installStoreFontAction,
  saveCartBehaviourAction,
  saveSavedThemeAction,
  saveThemeAction,
} from "./actions";

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
      <section aria-labelledby="cart-heading" className="max-w-3xl rounded-lg border border-border bg-background p-5">
        <h2 id="cart-heading" className="mb-1 font-medium">
          Cart
        </h2>
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
      </section>
    </div>
  );
}
