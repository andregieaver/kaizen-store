import "../globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** A drop-shipping supplier's page's own root (D541): no site chrome, no scripts of a site, no cookies; the page sets its own language. */
export default function SupplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
