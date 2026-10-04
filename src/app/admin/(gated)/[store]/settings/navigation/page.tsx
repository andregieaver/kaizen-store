import type { Metadata } from "next";
import Link from "next/link";

import { NavigationEditor } from "@/components/admin/navigation-editor";
import { marketPath, storeHref } from "@/lib/paths";
import { requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";
import { listStoreMenus } from "@/server/menus";

import { uploadImageAction } from "../../products/actions";
import { saveNavigationAction } from "./actions";

export const metadata: Metadata = { title: "Header and footer" };

/** The storefront's logo and icon (D30, D62), and the menus its standard header and footer show (D85). */
export default async function NavigationPage({ params }: PageProps<"/admin/[store]/settings/navigation">) {
  const { store } = await requirePermission((await params).store, "settings:read");
  const home = store.markets[0];
  const menus = await listStoreMenus(store.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Header and footer</h1>
        <p className="text-sm text-muted">
          Your logo, your icon and the menus {store.name}&apos;s standard header and footer show. To make or change a
          menu, go to{" "}
          <Link href={`/admin/${store.slug}/menus`} className="underline">
            Menus
          </Link>
          ; to lay out the header and footer themselves, build them under{" "}
          <Link href={`/admin/${store.slug}/headers`} className="underline">
            Headers
          </Link>{" "}
          and{" "}
          <Link href={`/admin/${store.slug}/footers`} className="underline">
            Footers
          </Link>
          .
        </p>
      </div>
      <NavigationEditor
        initial={{ ...store.navigation, headerMenuId: store.headerMenuId, footerMenuId: store.footerMenuId }}
        menus={menus.map(({ id, name }) => ({ id, name }))}
        menusHref={`/admin/${store.slug}/menus`}
        upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
        save={saveNavigationAction.bind(null, store.slug)}
        previewHref={home ? storeHref(store.slug, marketPath(store.slug, home.slug)) : "/"}
      />
    </div>
  );
}
