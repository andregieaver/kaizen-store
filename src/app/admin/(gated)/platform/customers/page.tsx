import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Avatar } from "@/components/avatar";
import { listPlatformCustomers } from "@/server/platform-customers";
import { requirePlatformAdmin } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
import { Card, CARD_CLASS, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Customers" };

/** Kaizen's customers (D35): the people who run stores, with their stores and plans. */
export default async function PlatformCustomersPage({ searchParams }: PageProps<"/admin/platform/customers">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").customers;
  const billingWords = adminText(lang, "billing");
  const roleWord = (role: string) => (adminText(lang, "staff").roles as Record<string, string>)[role] ?? role;
  const raw = (await searchParams).q;
  const q = typeof raw === "string" ? raw : "";
  const customers = await listPlatformCustomers({ q });
  const date = (iso: string) => new Date(iso).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <form role="search" className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="customer-search">
          {w.search}
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={w.search}
          className="min-h-10 w-full max-w-sm rounded-md border border-line bg-card px-3 text-sm"
        />
        <button type="submit" className="min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
          {w.searchButton}
        </button>
        {q && (
          <Link href="/admin/platform/customers" className="flex min-h-10 items-center px-2 text-sm underline">
            {w.everyone}
          </Link>
        )}
      </form>
      {customers.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {q ? w.noMatch : w.none}
        </p>
      ) : (
        <Card compact>
          <List label={w.title}>
            {customers.map((c) => (
              <ListRow key={c.id}>
                <RowLead
                  avatar={<Avatar avatar={avatarFor(c)} size={32} />}
                  title={c.name || c.email}
                  href={`/admin/platform/customers/${c.id}`}
                  sub={
                    <>
                      {c.name && `${c.email}`}
                      {c.disabled && w.disabled}
                    </>
                  }
                />
                <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5 text-body">
                  {c.stores.map((s) => (
                    <span key={s.slug}>
                      <Link href={`/admin/platform/stores/${s.slug}`} className="text-ink underline-offset-2 hover:underline">
                        {s.name}
                      </Link>{" "}
                      <span className="text-caption text-muted">
                        {roleWord(s.role)} · {s.planName && s.status ? `${s.planName}, ${billingWords.statuses[s.status] ?? s.status}` : w.noPlan}
                      </span>
                    </span>
                  ))}
                </span>
                <RowDate>{fillWords(w.since, { date: date(c.createdAt) })}</RowDate>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
