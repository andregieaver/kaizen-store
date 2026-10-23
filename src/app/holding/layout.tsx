import "../globals.css";

/** The holding page's own root (D317 8): no site chrome, no scripts of the site, no cookies. */
export default function HoldingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
