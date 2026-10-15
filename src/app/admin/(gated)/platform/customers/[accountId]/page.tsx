import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Avatar } from "@/components/avatar";
import { InvoiceList } from "@/components/admin/plan-invoices";
import { SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listStoreInvoices } from "@/server/billing";
import { listEmails } from "@/server/email";
import { getPlatformCustomer } from "@/server/platform-customers";
import { getStore } from "@/server/stores";
import { requirePlatformAdmin } from "@/server/auth";
import { twoStepOfAccount } from "@/server/team";
import { avatarFor } from "@/server/avatars";
import { CARD_CLASS, List, ListRow, PageHeader, RowDate, RowFact, RowLead } from "@/components/admin/ui";

import { resetTwoStepAction } from "./actions";

export const metadata: Metadata = { title: "Customer" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * One of Kaizen's customers (D35): their stores, each store's plan (the
 * subscription) and invoices (the orders), unpaid plans, and the emails
 * Kaizen sent them; each links to its own page, which links back here.
 */
export default async function PlatformCustomerPage({ params }: PageProps<"/admin/platform/customers/[accountId]">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const { accountId } = await params;
  if (!z.uuid().safeParse(accountId).success) notFound();
  const customer = await getPlatformCustomer(accountId);
  if (!customer) notFound();
  // Invoices go to the store's owners; staff see the store without them.
  const owned = customer.stores.filter((s) => s.role === "owner");
  const [invoices, emails] = await Promise.all([
    Promise.all(
      owned.map(async (s) => {
        const store = await getStore(s.slug);
        return { store: s, invoices: store ? await listStoreInvoices(store.id, 6) : null };
      }),
    ),
    listEmails({ storeId: null, to: customer.email, limit: 20 }),
  ]);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const kaizenEmails = emails.filter((e) => e.storeName === null);
  const twoStep = await twoStepOfAccount(accountId);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/customers", label: "Customers" }}
        title={<span className="flex items-center gap-3"><Avatar avatar={avatarFor(customer)} size={48} /> <span className="min-w-0 break-words">{customer.name || customer.email}</span></span>}
        meta={[
          <a key="email" href={`mailto:${customer.email}`} className="underline">
            {customer.email}
          </a>,
          `Since ${date(customer.createdAt)}`,
          customer.platformAdmin && "Platform admin",
          customer.disabled && "Disabled",
        ]}
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Stores", String(customer.stores.length)],
          ["On a plan", String(customer.onPlan)],
          ["Plan reminders", customer.planRemindersOptedOut ? "Said no" : "Allowed"],
        ].map(([label, value]) => (
          <div key={label} className={`flex flex-col gap-1 p-4 ${CARD_CLASS}`}>
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-medium">{value}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="two-step" className={card}>
        <h2 id="two-step" className="mb-1 text-title text-ink">
          Two-step sign-in
        </h2>
        <p className="mb-3 text-sm text-muted">
          {twoStep?.waitingToSetUp
            ? "Their second step was removed. They set it up again when they next sign in."
            : twoStep?.seen
              ? "On, as last seen. If they have lost their phone and their recovery codes, you can take it away: they are emailed and set it up again at their next sign-in."
              : "Not seen to be on."}
        </p>
        {customer.id === admin.id ? (
          <p className="text-sm text-muted">This is you. Change your own two-step sign-in on Your account; another platform admin can reset it if you are locked out.</p>
        ) : (
          <ActionForm action={resetTwoStepAction.bind(null, accountId)} className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" className="mt-1 size-4" />
              <span>I have checked that this is the person, and that they have lost their phone and their recovery codes.</span>
            </label>
            <div>
              <SubmitButton variant="secondary">Remove their two-step sign-in</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="stores" className={card}>
        <h2 id="stores" className="mb-3 text-title text-ink">Stores and plans</h2>
        {customer.stores.length === 0 ? (
          <p className="text-sm text-muted">Works in no store.</p>
        ) : (
          <List label="Stores">
            {customer.stores.map((s) => (
              <ListRow key={s.slug}>
                <RowLead
                  title={s.name}
                  href={`/admin/platform/stores/${s.slug}`}
                  sub={
                    <>
                      <span className="capitalize">{s.role}</span> ·{" "}
                      <Link href={`/admin/${s.slug}`} className="underline">
                        Store admin
                      </Link>
                    </>
                  }
                />
                <RowFact
                  sub={
                    s.planName && s.status
                      ? [SUBSCRIPTION_LABELS[s.status] ?? s.status, s.cancelAtPeriodEnd && "ends with the period", s.mode === "test" && "test mode"]
                          .filter(Boolean)
                          .join(" · ")
                      : undefined
                  }
                >
                  {s.planName && s.status ? s.planName : "No plan"}
                </RowFact>
                <RowDate>{s.currentPeriodEnd && s.status !== "canceled" ? `Next invoice ${date(s.currentPeriodEnd)}` : "No invoice due"}</RowDate>
              </ListRow>
            ))}
          </List>
        )}
      </section>

      <section aria-labelledby="invoices" className={card}>
        <h2 id="invoices" className="mb-3 text-title text-ink">Invoices</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-muted">Owns no store, so gets no invoices.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {invoices.map(({ store, invoices: list }) => (
              <div key={store.slug}>
                {owned.length > 1 && <h3 className="mb-1 text-body-strong text-ink">{store.name}</h3>}
                <InvoiceList storeSlug={store.slug} invoices={list} date={date} />
              </div>
            ))}
          </div>
        )}
      </section>

      {customer.unpaidPlans.length > 0 && (
        <section aria-labelledby="unpaid" className={card}>
          <h2 id="unpaid" className="mb-3 text-title text-ink">Went to pay for a plan</h2>
          <ul className="divide-y divide-line text-sm">
            {customer.unpaidPlans.map((u) => (
              <li key={`${u.storeSlug}-${u.capturedAt}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {u.planName} for{" "}
                  <Link href={`/admin/platform/stores/${u.storeSlug}`} className="underline">
                    {u.storeName}
                  </Link>
                </span>
                <span className="text-muted">
                  {date(u.capturedAt)} · {u.recovered ? "paid" : "not paid"} · {u.remindersSent} reminders
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="emails" className={card}>
        <h2 id="emails" className="mb-3 text-title text-ink">Emails from Kaizena Flow</h2>
        {kaizenEmails.length === 0 ? (
          <p className="text-sm text-muted">No emails yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {kaizenEmails.map((email) => (
              <li key={email.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/platform/emails/${email.id}`} className="underline">
                  {email.subject}
                </Link>
                <span className="text-muted">{date(email.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
