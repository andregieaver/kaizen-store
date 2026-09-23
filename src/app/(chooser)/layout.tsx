import type { Metadata } from "next";

import { siteUrl } from "@/lib/site";

import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: "Kaizen Store",
  description: "Kaizen Store: Norge, Sverige, Danmark.",
};

export default function ChooserLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nb" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
