import type { Metadata } from "next";

import { siteUrl } from "@/lib/site";

import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Kaizen",
  description: "Online stores for Norway and the EU, fast by design.",
};

export default function PlatformLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
