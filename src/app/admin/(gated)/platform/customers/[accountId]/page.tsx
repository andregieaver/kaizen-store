import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Avatar } from "@/components/avatar";
import { InvoiceList } from "@/components/admin/plan-invoices";
import { listStoreInvoices } from "@/server/billing";
import { listEmails } from "@/server/email";
import { houseCustomerOfAccount } from "@/server/house-customers";
import { getPlatformCustomer } from "@/server/platform-customers";
import { getStore } from "@/server/stores";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { pendingEmailChange } from "@/server/email-change";
import { twoStepOfAccount } from "@/server/team";
import { avatarFor } from "@/server/avatars";
import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { CARD_CLASS, Field, List, ListRow, PageHeader, RowDate, RowFact, RowLead, TextInput } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { NAME_MAX } from "@/lib/email-change-limits";

import { cancelEmailChangeForAction, correctNameAction, resetTwoStepAction, sendEmailChangeAction } from "./actions";

export const metadata: Metadata = { title: "Customer" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * One of Kaizen's customers (D35): their stores, each store's plan (the
 * subscription) and invoices (the orders), unpaid plans, and the emails
 * Kaizen sent them; each links to its own page, which links back here.
 */
export default async function PlatformCustomerPage({ params }: PageProps<"/admin/platform/customers/[accountId]">) {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "platform").customer;
  const billingWords = adminText(lang, "billing");
  const roleWord = (role: string) => (adminText(lang, "staff").roles as Record<string, string>)[role] ?? role;
  const invoiceWords = adminText(lang, "platform").invoiceList;
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
  const date = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "day", lang);
  const kaizenEmails = emails.filter((e) => e.storeName === null);
  const twoStep = await twoStepOfAccount(accountId);
  // The same person as a customer of Kaizena Flow's own store (D467): its tags, deals, notes and timeline are kept there.
  const house = await houseCustomerOfAccount(accountId);
  // Their name corrected by the stores area (support and owners), a link to a new address sent by an owner (D836); their own on Your account.
  const pending = await pendingEmailChange(accountId);
  const mayName = platformCan(admin, "stores") && customer.id !== admin.id && !customer.disabled;
  const maySend = admin.platformAdmin && customer.id !== admin.id && !customer.disabled;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/customers", label: w.customers }}
        title={<span className="flex items-center gap-3"><Avatar avatar={avatarFor(customer)} size={48} /> <span className="min-w-0 break-words">{customer.name || customer.email}</span></span>}
        meta={[
          <a key="email" href={`mailto:${customer.email}`} className="underline">
            {customer.email}
          </a>,
          fillWords(w.since, { date: date(customer.createdAt) }),
          customer.platformAdmin && w.platformAdmin,
          customer.disabled && w.disabled,
          house && (
            <Link key="house" href={`/admin/${house.storeSlug}/customers/${house.customerId}`} className="underline">
              {w.inHouseStore}
            </Link>
          ),
        ]}
      />

      <div className="grid grid-cols-3 gap-3">
        {[
          [w.stores, String(customer.stores.length)],
          [w.onPlan, String(customer.onPlan)],
          [w.planReminders, customer.planRemindersOptedOut ? w.saidNo : w.allowed],
        ].map(([label, value]) => (
          <div key={label} className={`flex flex-col gap-1 p-4 ${CARD_CLASS}`}>
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-medium">{value}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="details" className={card} data-customer-details="">
        <h2 id="details" className="mb-1 text-title text-ink">
          {w.details}
        </h2>
        {customer.id === admin.id ? (
          <p className="text-sm text-muted">
            <Link href="/admin/account" className="underline">
              {w.yourOwn}
            </Link>
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">{w.detailsText}</p>
            {mayName && (
              <ActionForm action={correctNameAction.bind(null, accountId)} className="flex max-w-md flex-col gap-3">
                <Field label={w.name} required>
                  {(control) => <TextInput name="name" defaultValue={customer.name} maxLength={NAME_MAX} autoComplete="off" full {...control} />}
                </Field>
                <div>
                  <SubmitButton variant="secondary">{w.saveName}</SubmitButton>
                </div>
              </ActionForm>
            )}
            {pending && (
              <div role="status" className="flex flex-wrap items-center gap-3 text-sm [overflow-wrap:anywhere]">
                <span>{fillWords(w.pending, { email: pending.email, until: adminDate(PLATFORM_TIME_ZONE, pending.expiresAt, "dayTime", lang) })}</span>
                {maySend && (
                  <QuietActionForm action={cancelEmailChangeForAction.bind(null, accountId)}>
                    <SubmitButton variant="secondary">{w.cancelChange}</SubmitButton>
                  </QuietActionForm>
                )}
              </div>
            )}
            {maySend ? (
              <ActionForm action={sendEmailChangeAction.bind(null, accountId)} className="flex max-w-md flex-col gap-3">
                <Field label={w.newEmail} required>
                  {(control) => <TextInput name="email" type="email" autoComplete="off" spellCheck={false} full {...control} />}
                </Field>
                <div>
                  <SubmitButton variant="secondary">{w.sendLink}</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              !admin.platformAdmin && <p className="text-sm text-muted">{w.ownersSend}</p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="two-step" className={card}>
        <h2 id="two-step" className="mb-1 text-title text-ink">
          {w.twoStep}
        </h2>
        <p className="mb-3 text-sm text-muted">
          {twoStep?.waitingToSetUp
            ? w.waiting
            : twoStep?.seen
              ? w.seen
              : w.notSeen}
        </p>
        {customer.id === admin.id ? (
          <p className="text-sm text-muted">{w.you}</p>
        ) : (
          <ActionForm action={resetTwoStepAction.bind(null, accountId)} className="flex flex-col gap-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="confirm" className="mt-1 size-4" />
              <span>{w.confirm}</span>
            </label>
            <div>
              <SubmitButton variant="secondary">{w.reset}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </section>

      <section aria-labelledby="stores" className={card}>
        <h2 id="stores" className="mb-3 text-title text-ink">{w.storesAndPlans}</h2>
        {customer.stores.length === 0 ? (
          <p className="text-sm text-muted">{w.noStore}</p>
        ) : (
          <List label={w.stores}>
            {customer.stores.map((s) => (
              <ListRow key={s.slug}>
                <RowLead
                  title={s.name}
                  href={`/admin/platform/stores/${s.slug}`}
                  sub={
                    <>
                      <span>{roleWord(s.role)}</span> ·{" "}
                      <Link href={`/admin/${s.slug}`} className="underline">
                        {w.storeAdmin}
                      </Link>
                    </>
                  }
                />
                <RowFact
                  sub={
                    s.planName && s.status
                      ? [billingWords.statuses[s.status] ?? s.status, s.cancelAtPeriodEnd && w.endsWithPeriod, s.mode === "test" && w.testMode]
                          .filter(Boolean)
                          .join(" · ")
                      : undefined
                  }
                >
                  {s.planName && s.status ? s.planName : w.noPlan}
                </RowFact>
                <RowDate>{s.currentPeriodEnd && s.status !== "canceled" ? fillWords(w.nextInvoice, { date: adminDate(s, s.currentPeriodEnd, "day", lang) }) : w.noInvoiceDue}</RowDate>
              </ListRow>
            ))}
          </List>
        )}
      </section>

      <section aria-labelledby="invoices" className={card}>
        <h2 id="invoices" className="mb-3 text-title text-ink">{w.invoices}</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-muted">{w.ownsNone}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {invoices.map(({ store, invoices: list }) => (
              <div key={store.slug}>
                {owned.length > 1 && <h3 className="mb-1 text-body-strong text-ink">{store.name}</h3>}
                <InvoiceList storeSlug={store.slug} invoices={list} date={(iso) => adminDate(store, iso, "day", lang)} words={invoiceWords} />
              </div>
            ))}
          </div>
        )}
      </section>

      {customer.unpaidPlans.length > 0 && (
        <section aria-labelledby="unpaid" className={card}>
          <h2 id="unpaid" className="mb-3 text-title text-ink">{w.wentToPay}</h2>
          <ul className="divide-y divide-line text-sm">
            {customer.unpaidPlans.map((u) => (
              <li key={`${u.storeSlug}-${u.capturedAt}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {fillWords(w.planFor, { plan: u.planName })}{" "}
                  <Link href={`/admin/platform/stores/${u.storeSlug}`} className="underline">
                    {u.storeName}
                  </Link>
                </span>
                <span className="text-muted">
                  {date(u.capturedAt)} · {u.recovered ? w.paid : w.notPaid} · {fillWords(w.reminders, { n: u.remindersSent })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="emails" className={card}>
        <h2 id="emails" className="mb-3 text-title text-ink">{w.emails}</h2>
        {kaizenEmails.length === 0 ? (
          <p className="text-sm text-muted">{w.noEmails}</p>
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
