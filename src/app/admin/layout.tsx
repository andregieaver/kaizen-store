import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminProgress } from "@/components/admin/admin-progress";
import { railNamesScript } from "@/lib/admin-rail";
import { adminLangScript } from "@/lib/admin-lang";
import { adminSchemeScript } from "@/lib/admin-schemes";
import { ADMIN_COLOR_KEY, colorModeScript } from "@/lib/color-mode";
import { siteIcons } from "@/lib/site-icons";
import { getPlatformFavicon } from "@/server/platform-navigation";

import "../globals.css";
// The colour schemes (docs/admin-style.md section 4), each setting the colour roles; `admin.css` reads only the roles.
import "./schemes/meadow.css";
import "./schemes/indigo.css";
import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Kaizena Flow admin", template: "%s · Kaizena Flow admin" },
    robots: { index: false, follow: false },
    // Kaizen's icon (D62).
    icons: siteIcons(await getPlatformFavicon()),
  };
}

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    // The account's light or dark (D99) and colour scheme (D221) are on <html> before the page is drawn, so it never flashes other colours;
    // so is whether the rail shows its sections' names (D262), so it never widens after, and the account's language (D312 A0) on its `lang`.
    <html lang="en" data-admin="" className="h-full scroll-pt-20 antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorModeScript(ADMIN_COLOR_KEY) + adminSchemeScript() + railNamesScript() + adminLangScript() }} />
      </head>
      <body className="min-h-full bg-sunken font-sans">
        {/* Reads the address, so it waits in its own boundary and never holds the page back. */}
        <Suspense fallback={null}>
          <AdminProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
