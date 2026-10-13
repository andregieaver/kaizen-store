import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminProgress } from "@/components/admin/admin-progress";
import { ADMIN_COLOR_KEY, colorModeScript } from "@/lib/color-mode";
import { siteIcons } from "@/lib/site-icons";
import { getPlatformFavicon } from "@/server/platform-navigation";

import "../globals.css";
import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: { default: "Kaizen admin", template: "%s · Kaizen admin" },
    robots: { index: false, follow: false },
    // Kaizen's icon (D62).
    icons: siteIcons(await getPlatformFavicon()),
  };
}

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    // The account's light or dark (D99) is on <html> before the page is drawn, so it never flashes the other colours.
    <html lang="en" data-admin="" className="h-full scroll-pt-20 antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: colorModeScript(ADMIN_COLOR_KEY) }} />
      </head>
      <body className="min-h-full bg-surface font-sans">
        {/* Reads the address, so it waits in its own boundary and never holds the page back. */}
        <Suspense fallback={null}>
          <AdminProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
