import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ConfirmForm, InviteForm } from "@/components/company-forms";
import { percentText } from "@/lib/customer-tiers";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { companyOf, listInvites, listMembers } from "@/server/companies";
import { getCustomer } from "@/server/customers";
import { memberDiscountFor } from "@/server/customer-tiers";
import { db } from "@/db/client";
import { resolveShop } from "@/server/shop";

import { leaveCompanyAction, removeEmployeeAction, revokeInviteAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/account/company">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * My company (D108): a company's main account invites its employees by
 * email, sees who is in and who is waiting, and withdraws an invitation or
 * removes an employee at any time. An employee sees their company and can
 * leave it.
 */
export default function CompanyPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Company params={params} />
      </Suspense>
    </div>
  );
}

async function Company({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const account = marketPath(store.slug, market.slug, "/account");
  const customer = await getCustomer(store.id);
  const mine = customer ? await companyOf(store.id, customer.id) : null;
  if (!customer || !mine) redirect(account);
  const m = t(market.lang).companyAccount;
  const owner = mine.role === "owner";
  const [members, invites, discount] = owner
    ? await Promise.all([listMembers(store.id, mine.company.id), listInvites(store.id, mine.company.id), memberDiscountFor(db(), store.id, customer.id)])
    : [[], [], await memberDiscountFor(db(), store.id, customer.id)];
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "medium" });
  const status = { pending: m.waiting, accepted: m.accepted, revoked: m.revoked, ended: m.ended };
  const box = "divide-y divide-border rounded-lg border border-border";

  return (
    <>
      <div>
        <Link href={account} className="text-sm underline">
          ← {t(market.lang).account.title}
        </Link>
        <h1 className="mt-2 text-3xl font-heading tracking-tight">{mine.company.name}</h1>
        <p className="text-sm text-muted">{m.yourRole(owner ? m.roleOwner : m.roleEmployee)}</p>
        <p className="mt-2">{discount ? m.discountYou(percentText(discount.percent)) : m.noDiscount}</p>
      </div>

      {owner ? (
        <>
          <section aria-labelledby="invite-heading" className="flex flex-col gap-3">
            <h2 id="invite-heading" className="text-xl font-heading">
              {m.inviteTitle}
            </h2>
            <p className="text-sm text-muted">{m.inviteHelp}</p>
            <InviteForm store={store.slug} market={market.slug} labels={{ label: m.inviteLabel, button: m.inviteButton, sending: m.sending }} />
          </section>

          <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
            <h2 id="accounts-heading" className="text-xl font-heading">
              {m.accounts} ({members.length}/{mine.company.maxMembers})
            </h2>
            <ul className={box}>
              {members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {member.name || member.email}
                      {member.id === customer.id && <span className="font-normal text-muted"> ({m.you})</span>}
                    </span>
                    {member.name && <span className="block truncate text-sm text-muted">{member.email}</span>}
                  </span>
                  <span className="text-sm text-muted">{member.role === "owner" ? m.roleOwner : m.roleEmployee}</span>
                  {member.role === "employee" && (
                    <ConfirmForm action={removeEmployeeAction.bind(null, store.slug, market.slug, member.id)} confirm={m.removeConfirm(member.email)} className="text-sm text-red-700 underline dark:text-red-400">
                      {m.remove}
                    </ConfirmForm>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="invitations-heading" className="flex flex-col gap-3">
            <h2 id="invitations-heading" className="text-xl font-heading">
              {m.invitations}
            </h2>
            {invites.length === 0 ? (
              <p className="text-muted">{m.noInvitations}</p>
            ) : (
              <ul className={box}>
                {invites.map((invite) => {
                  const open = invite.status === "pending" && !invite.expired;
                  return (
                    <li key={invite.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                      <span className="min-w-0 flex-1 truncate">{invite.email}</span>
                      <span className="text-sm text-muted">
                        {invite.status === "pending" && invite.expired ? m.expired : status[invite.status]} · {date(invite.createdAt)}
                      </span>
                      {open && (
                        <ConfirmForm action={revokeInviteAction.bind(null, store.slug, market.slug, invite.id)} className="text-sm underline">
                          {m.revoke}
                        </ConfirmForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <section aria-labelledby="leave-heading" className="flex flex-col gap-3">
          <h2 id="leave-heading" className="text-xl font-heading">
            {m.leave}
          </h2>
          <p className="text-sm text-muted">{m.leaveHelp}</p>
          <div>
            <ConfirmForm action={leaveCompanyAction.bind(null, store.slug, market.slug)} confirm={m.leaveHelp} className="min-h-11 rounded-button border border-border px-5">
              {m.leave}
            </ConfirmForm>
          </div>
        </section>
      )}
    </>
  );
}
