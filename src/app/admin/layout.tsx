import type { Metadata } from "next";

import { siteIcons } from "@/lib/site-icons";
import { getPlatformFavicon } from "@/server/platform-navigation";

import "../globals.css";

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
    <html lang="en" className="h-full scroll-pt-20 antialiased">
      <body className="min-h-full bg-surface font-sans">{children}</body>
    </html>
  );
}
