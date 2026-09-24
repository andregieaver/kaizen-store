import type { Metadata } from "next";

import "../globals.css";

export const metadata: Metadata = {
  title: { default: "Kaizen admin", template: "%s · Kaizen admin" },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <html lang="en" className="h-full scroll-pt-20 antialiased">
      <body className="min-h-full bg-surface font-sans">{children}</body>
    </html>
  );
}
