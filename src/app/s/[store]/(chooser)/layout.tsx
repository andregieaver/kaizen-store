import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { siteUrl } from "@/lib/site";
import { templateStoreSlug, getOpenStore } from "@/server/stores";

import "../../../globals.css";

type Props = LayoutProps<"/s/[store]">;

export async function generateStaticParams() {
  const slug = await templateStoreSlug();
  return [{ store: slug ?? "_" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await getOpenStore((await params).store);
  if (!store) return {};
  return {
    metadataBase: new URL(siteUrl()),
    title: store.name,
    description: `${store.name}: ${store.markets.map((m) => m.name).join(", ")}.`,
  };
}

export default async function ChooserLayout({ children, params }: Props) {
  const store = await getOpenStore((await params).store);
  if (!store) notFound();
  return (
    <html lang={store.markets[0]?.lang ?? "en"} className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
