import "../globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = { referrer: "no-referrer" };

/** A product passport's own root (D554): no site chrome, no scripts of a site, no cookies; read by whoever scans the product's code. */
export default function PassportLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
