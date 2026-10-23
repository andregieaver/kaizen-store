import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { NavigationEditor } from "@/components/admin/navigation-editor";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { listPlatformMenus } from "@/server/menus";
import { getPlatformNavigationForEdit } from "@/server/platform-navigation";
import { PageHeader } from "@/components/admin/ui";

import { uploadPlatformImageAction } from "../actions";
import { savePlatformNavigationAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Header and footer" };

/** Kaizen's own logo, icon and business details (D42), and the menus its standard header and footer show (D85). */
export default async function PlatformNavigationPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const n = (await platformSiteWords()).w.misc.navigation;
  const [{ navigation, business, headerMenuId, footerMenuId }, menus] = await Promise.all([
    getPlatformNavigationForEdit(),
    listPlatformMenus(),
  ]);
  return (
    <>
      <PageHeader
        title={n.title}
        description={
          <>
            {n.before}{" "}
            <Link href="/admin/platform/menus" className="underline">
              {n.menus}
            </Link>
            {n.middle}{" "}
            <Link href="/admin/platform/headers" className="underline">
              {n.headers}
            </Link>{" "}
            {n.and}{" "}
            <Link href="/admin/platform/footers" className="underline">
              {n.footers}
            </Link>
            .
          </>
        }
      />
      <NavigationEditor
        initial={{ ...navigation, headerMenuId, footerMenuId }}
        menus={menus.map(({ id, name }) => ({ id, name }))}
        menusHref="/admin/platform/menus"
        copy={n.copy}
        business={business}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
        save={savePlatformNavigationAction}
        previewHref="/"
      />
    </>
  );
}
