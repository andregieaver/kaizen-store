import Link from "next/link";

import { storeBase } from "@/lib/paths";
import { requireMember } from "@/server/auth";

export default async function StoreAdminLayout({
  children,
  params,
}: LayoutProps<"/admin/[store]">) {
  const { store, role } = await requireMember((await params).store);
  const base = `/admin/${store.slug}`;
  const nav = [
    { href: base, label: "Overview" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/settings/payments`, label: "Payments" },
    { href: `${base}/staff`, label: "Staff" },
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
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
