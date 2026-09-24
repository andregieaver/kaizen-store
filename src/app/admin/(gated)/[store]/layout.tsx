import { headers } from "next/headers";
import Link from "next/link";
import { after } from "next/server";

import { storeBase } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { ensureTestAccount } from "@/server/connect";

export default async function StoreAdminLayout({
  children,
  params,
}: LayoutProps<"/admin/[store]">) {
  const { account, store, role } = await requireMember((await params).store);
  // In test mode, Kaizen sets up the store's test Stripe account itself, after
  // the page is sent, so test purchases work without any setup (D20).
  if (store.paymentsTest) {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
    after(() => ensureTestAccount(store.id, account.id, ip));
  }
  const base = `/admin/${store.slug}`;
  const nav = [
    { href: base, label: "Overview" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/settings/shipping`, label: "Shipping" },
    { href: `${base}/settings/payments`, label: "Payments" },
    { href: `${base}/staff`, label: "Staff" },
    { href: `${base}/billing`, label: "Plan" },
  ];

  return (
    <>
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <nav aria-label={`${store.name} admin`} className="flex items-center gap-4">
            <span className="font-medium">{store.name}</span>
            <ul className="flex gap-1 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="rounded px-2 py-1 hover:bg-surface">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">{role}</span>
            <Link href={storeBase(store.slug)} className="underline">
              View store
            </Link>
            <Link href="/admin/stores" className="underline">
              All stores
            </Link>
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
