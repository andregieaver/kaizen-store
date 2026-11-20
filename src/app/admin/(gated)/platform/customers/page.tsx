import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { Avatar } from "@/components/avatar";
import { platformCustomerPage } from "@/server/platform-customers";
import { requirePlatformReader } from "@/server/auth";
import { avatarFor } from "@/server/avatars";
import { ButtonLink, Card, EmptyState, List, ListRow, ListSearch, PageHeader, Pager, RowDate, RowLead } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { LIST_PAGE_SIZE, listOffset, listPage } from "@/lib/list-page";
import { BILLING_WORDS } from "@/lib/admin-words/billing";
import { KIT_WORDS } from "@/lib/admin-words/kit";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { STAFF_WORDS } from "@/lib/admin-words/staff";

export const metadata: Metadata = { title: "Customers" };

/** Kaizen's customers (D35): the people who run stores, with their stores and plans. */
export default async function PlatformCustomersPage({ searchParams }: PageProps<"/admin/platform/customers">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_WORDS[lang].customers;
  const billingWords = BILLING_WORDS[lang];
  const roleWord = (role: string) => (STAFF_WORDS[lang].roles as Record<string, string>)[role] ?? role;
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q : "";
  // A hundred a page, with how many the search finds in all (code review 1.13, D834); a page past the last opens the first.
  const page = listPage(query.page);
  const { rows: customers, total } = await platformCustomerPage({ q, limit: LIST_PAGE_SIZE, offset: listOffset(page) });
  if (customers.length === 0 && page > 1) redirect(q ? `/admin/platform/customers?q=${encodeURIComponent(q)}` : "/admin/platform/customers");
  const date = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "day", lang);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <ListSearch
        action="/admin/platform/customers"
        id="customer-search"
        value={q}
        placeholder={w.search}
        words={{ label: w.search, button: w.searchButton }}
        className="max-w-xl"
        aside={
          q && (
            <Link href="/admin/platform/customers" className="flex min-h-10 items-center px-2 text-sm underline">
              {w.everyone}
            </Link>
          )
        }
      />
      {customers.length === 0 ? (
        <EmptyState title={q ? w.noMatch : w.none} action={q && <ButtonLink href="/admin/platform/customers">{w.everyone}</ButtonLink>} />
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
                      {c.stores[0] && <span className="sm:hidden"> · {c.stores[0].name}{c.stores.length > 1 ? ` +${c.stores.length - 1}` : ""}</span>}
                    </>
                  }
                />
                <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5 text-body max-sm:hidden">
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
                <span className="contents max-sm:hidden">
                  <RowDate>{fillWords(w.since, { date: date(c.createdAt) })}</RowDate>
                </span>
              </ListRow>
            ))}
          </List>
          <Pager
            words={KIT_WORDS[lang].pager}
            label={w.title}
            base="/admin/platform/customers"
            query={{ q: q || undefined }}
            page={page}
            size={LIST_PAGE_SIZE}
            shown={customers.length}
            total={total}
          />
        </Card>
      )}
    </div>
  );
}
