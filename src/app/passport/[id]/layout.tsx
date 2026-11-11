import "../../globals.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { publicPassport } from "@/server/product-passports";

export const metadata: Metadata = { referrer: "no-referrer" };

/** Cache Components needs one address to prerender; "_" is never a passport, so it is a 404. Real ones are drawn when first asked for. */
export function generateStaticParams() {
  return [{ id: "_" }];
}

/**
 * A product passport's own root (D554): no site chrome, no scripts of a site, no cookies; read by whoever scans the product's code. The passport is read
 * (cached) here, before anything is sent, so an address with no published passport answers a real 404 (D562, the platform's `global-not-found`).
 */
export default async function PassportLayout({ children, params }: LayoutProps<"/passport/[id]">) {
  const passport = await publicPassport((await params).id);
  if (!passport) notFound();
  return (
    <html lang={passport.lang}>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
