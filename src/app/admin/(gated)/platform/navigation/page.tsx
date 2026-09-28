import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { NavigationEditor, type NavigationCopy } from "@/components/admin/navigation-editor";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { listPlatformMenus } from "@/server/menus";
import { getPlatformNavigationForEdit } from "@/server/platform-navigation";

import { uploadPlatformImageAction } from "../actions";
import { savePlatformNavigationAction } from "./actions";

export const metadata: Metadata = { title: "Header and footer" };

const COPY: NavigationCopy = {
  logo: "Shown in the header instead of Kaizen's name, up to 40 pixels high. A wide PNG with a transparent background works best. Without a logo, the header shows the name.",
  logoDark:
    "Optional: a light version of the logo, shown instead to visitors in dark mode. Without it, the logo above is shown in both.",
  header:
    "Across the top on computers, and in the slide-out menu on phones. Sign in and Start your store are always there, so they need no link in it.",
  footer: "At the bottom of every page, beside the business details below.",
  saved: "Saved. Kaizen's pages show it now.",
  view: "View the site",
};

/** Kaizen's own logo, icon and business details (D42), and the menus its standard header and footer show (D85). */
export default async function PlatformNavigationPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [{ navigation, business, headerMenuId, footerMenuId }, menus] = await Promise.all([
    getPlatformNavigationForEdit(),
    listPlatformMenus(),
  ]);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Header and footer</h1>
        <p className="max-w-2xl text-sm text-muted">
          Kaizen&apos;s logo, its icon, who runs it and the menus its standard header and footer show. To make or
          change a menu, go to{" "}
          <Link href="/admin/platform/menus" className="underline">
            Menus
          </Link>
          ; to lay out the header and footer themselves, build them under{" "}
          <Link href="/admin/platform/headers" className="underline">
            Headers
          </Link>{" "}
          and{" "}
          <Link href="/admin/platform/footers" className="underline">
            Footers
          </Link>
          .
        </p>
      </div>
      <NavigationEditor
        initial={{ ...navigation, headerMenuId, footerMenuId }}
        menus={menus.map(({ id, name }) => ({ id, name }))}
        menusHref="/admin/platform/menus"
        copy={COPY}
        business={business}
        upload={uploadsEnabled() ? uploadPlatformImageAction : null}
        save={savePlatformNavigationAction}
        previewHref="/"
      />
    </>
  );
}
