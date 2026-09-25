import Link from "next/link";
import { requirePlatformAdmin } from "@/server/auth";

/** Kaizen's own admin: access requests, stores' plans and fees, plans, Stripe. */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  await requirePlatformAdmin();
  const nav = [
    { href: "/admin/platform", label: "Access requests" },
    { href: "/admin/platform/customers", label: "Customers" },
    { href: "/admin/platform/stores", label: "Stores" },
    { href: "/admin/platform/plans", label: "Plans" },
    { href: "/admin/platform/discounts", label: "Discounts" },
    { href: "/admin/platform/plan-reminders", label: "Plan reminders" },
    { href: "/admin/platform/stripe", label: "Stripe" },
    { href: "/admin/platform/seo", label: "Search" },
    { href: "/admin/platform/emails", label: "Emails" },
  ];
  return (
    <>
      <div className="border-b border-border bg-background">
        <nav aria-label="Kaizen platform" className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-2">
          <span className="font-medium">Platform</span>
          <ul className="flex flex-wrap gap-1 text-sm">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="rounded px-2 py-1 hover:bg-surface">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">{children}</main>
    </>
  );
}
