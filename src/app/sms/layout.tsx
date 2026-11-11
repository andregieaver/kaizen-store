import "../globals.css";

import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** The stop link's page's own root (SMS marketing, D565): no site chrome, no scripts of a site, no cookies; the page sets its own language. */
export default function SmsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
