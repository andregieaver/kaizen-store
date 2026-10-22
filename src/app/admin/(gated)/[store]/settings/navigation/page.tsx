import type { Metadata } from "next";
import Link from "next/link";

import { NavigationEditor } from "@/components/admin/navigation-editor";
import { marketPath, storeHref } from "@/lib/paths";
import { requirePermission } from "@/server/permissions";
import { uploadsEnabled } from "@/server/media";
import { listStoreMenus } from "@/server/menus";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";

import { uploadImageAction } from "../../products/actions";
import { saveNavigationAction } from "./actions";

export const metadata: Metadata = { title: "Header and footer" };

/** The storefront's logo and icon (D30, D62), and the menus its standard header and footer show (D85). */
export default async function NavigationPage({ params }: PageProps<"/admin/[store]/settings/navigation">) {
  const { store, account } = await requirePermission((await params).store, "settings:read");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "website").navigation;
  const home = store.markets[0];
  const menus = await listStoreMenus(store.id);

  return (
    <AdminTextScope texts={adminTexts(lang, ["website"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{fillWords(w.descriptionStart, { store: store.name })}<Link href={`/admin/${store.slug}/menus`} className="underline">{w.menusLink}</Link>{w.descriptionMiddle}<Link href={`/admin/${store.slug}/headers`} className="underline">{w.headersLink}</Link>{w.and}<Link href={`/admin/${store.slug}/footers`} className="underline">{w.footersLink}</Link>{w.descriptionEnd}</>}
      />
      <NavigationEditor
        initial={{ ...store.navigation, headerMenuId: store.headerMenuId, footerMenuId: store.footerMenuId }}
        menus={menus.map(({ id, name }) => ({ id, name }))}
        menusHref={`/admin/${store.slug}/menus`}
        upload={uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null}
        save={saveNavigationAction.bind(null, store.slug)}
        previewHref={home ? storeHref(store.slug, marketPath(store.slug, home.slug)) : "/"}
      />
    </div>
    </AdminTextScope>
  );
}
