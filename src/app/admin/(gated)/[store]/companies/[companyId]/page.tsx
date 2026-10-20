import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CompanyFields } from "@/components/admin/company-fields";
import { requirePermission } from "@/server/permissions";
import { employeePercent, getCompany, listInvites, listMembers } from "@/server/companies";
import { companyOwes } from "@/server/payment-terms";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { PAYMENT_TERMS, TERMS_LABELS } from "@/lib/payment-terms";
import { formatPriceInput } from "@/lib/product-input";
import { listTiers } from "@/server/customer-tiers";
import { PageHeader } from "@/components/admin/ui";

import {
  deleteCompanyAction,
  inviteToCompanyAction,
  lookupRegisterCompanyAction,
  removeCompanyMemberAction,
  revokeCompanyInviteAction,
  saveCompanyAction,
  saveCompanyTermsAction,
  searchRegisterCompaniesAction,
  setMainAccountAction,
} from "../actions";

export const metadata: Metadata = { title: "Company" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";

export default async function CompanyPage({ params }: PageProps<"/admin/[store]/companies/[companyId]">) {
  const { store: slug, companyId } = await params;
  const current = await requirePermission(slug, "customers:read");
  const off = requireFeature(current, "business");
  if (off) return off;
  const { store } = current;
  if (!z.uuid().safeParse(companyId).success) notFound();
  const company = await getCompany(store.id, companyId);
  if (!company) notFound();
  const [groups, members, invites, owes] = await Promise.all([listTiers(store.id), listMembers(store.id, company.id), listInvites(store.id, company.id), companyOwes(store.id, company.id)]);
  const currency = mainCurrency(store);
  const base = `/admin/${store.slug}`;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const employees = employeePercent(company);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/companies`, label: "Companies" }}
        title={<>{company.name}</>}
        description={<>{!company.active ? "Switched off: its accounts get no discount and it invites no one." : company.tierName && company.tierActive ? `${company.tierName}: ${company.tierPercent} % for the main account${employees ? `, ${employees} % for employees` : ", nothing for employees"}.` : "No customer group, or it is switched off: no discount."}</>}
      />

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className="text-title text-ink">
          Settings
        </h2>
        <ActionForm action={saveCompanyAction.bind(null, store.slug, company.id)} className="flex flex-col gap-3">
          <CompanyFields
            groups={groups}
            values={company}
            lookup={lookupRegisterCompanyAction.bind(null, store.slug)}
            search={searchRegisterCompaniesAction.bind(null, store.slug)}
          />
          <div>
            <SubmitButton>Save</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="terms" className={card}>
        <h2 id="terms" className="text-title text-ink">
          Payment terms
        </h2>
        <p className="text-sm text-muted">
          With terms, the company&apos;s accounts can choose <em>Pay by invoice</em> at checkout: the order is confirmed at once and the invoice is due after
          the days you choose. Reminders go three days before and the day after.
        </p>
        {owes.length > 0 && (
          <p className="text-sm text-ink">
            Owes now:{" "}
            {owes
              .map((o) => `${formatMoney(o.owedMinor, o.currency, locale)} on ${o.orders} ${o.orders === 1 ? "order" : "orders"}${o.overdueMinor > 0 ? `, ${formatMoney(o.overdueMinor, o.currency, locale)} overdue` : ""}`)
              .join("; ")}
          </p>
        )}
        <ActionForm action={saveCompanyTermsAction.bind(null, store.slug, company.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Terms
            <select name="terms" defaultValue={company.paymentTerms ?? ""} className={`${control} max-w-xs`}>
              <option value="">No payment terms</option>
              {PAYMENT_TERMS.map((terms) => (
                <option key={terms} value={terms}>
                  {TERMS_LABELS[terms]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Credit limit ({currency}, optional)
            <input
              name="creditLimit"
              inputMode="decimal"
              defaultValue={company.creditLimitMinor === null ? "" : formatPriceInput(company.creditLimitMinor, company.creditCurrency ?? currency)}
              className={`${control} max-w-xs`}
            />
            <span className="font-normal text-muted">
              What the company may owe at once. Leave empty for no limit.
              {company.creditCurrency && company.creditCurrency !== currency ? ` Kept in ${company.creditCurrency}.` : ""}
            </span>
          </label>
          <div>
            <SubmitButton>Save terms</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="accounts" className={card}>
        <h2 id="accounts" className="text-title text-ink">
          Accounts ({members.length}/{company.maxMembers})
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">No accounts yet. Set a main account below.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <Link href={`${base}/customers/${member.id}`} className="font-medium underline-offset-2 hover:underline">
                    {member.name || member.email}
                  </Link>
                  <span className="block truncate text-muted">
                    {member.name ? `${member.email} · ` : ""}
                    {member.role === "owner" ? "Main account" : "Employee"} · since {date(member.joinedAt)}
                    {member.verified ? "" : " · not signed in yet"}
                  </span>
                </span>
                <ActionForm action={removeCompanyMemberAction.bind(null, store.slug, company.id)} className="flex items-center">
                  <input type="hidden" name="customerId" value={member.id} />
                  <SubmitButton variant="secondary">
                    Remove<span className="sr-only"> {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={setMainAccountAction.bind(null, store.slug, company.id)} className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Add a main account by email
            <span className="flex flex-wrap gap-2">
              <input type="email" name="email" required className={`${control} min-w-64 flex-1`} />
              <SubmitButton variant="secondary">Add</SubmitButton>
            </span>
            <span className="font-normal text-muted">The main account invites employees and withdraws invitations. An account belongs to one company at most.</span>
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="invitations" className={card}>
        <h2 id="invitations" className="text-title text-ink">
          Invitations
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {invites.map((invite) => {
              const open = invite.status === "pending" && !invite.expired;
              const label = invite.status === "pending" ? (invite.expired ? "Expired" : "Waiting") : { accepted: "Accepted", revoked: "Withdrawn", ended: "Employee removed" }[invite.status];
              return (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{invite.email}</span>
                    <span className="block text-muted">
                      {label} · sent {date(invite.createdAt)}
                      {open ? ` · valid until ${date(invite.expiresAt)}` : ""}
                    </span>
                  </span>
                  {open && (
                    <ActionForm action={revokeCompanyInviteAction.bind(null, store.slug, company.id)} className="flex items-center">
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <SubmitButton variant="secondary">
                        Withdraw<span className="sr-only"> the invitation to {invite.email}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <ActionForm action={inviteToCompanyAction.bind(null, store.slug, company.id)} className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Invite employees as the store
            <textarea name="emails" rows={2} required placeholder="anna@example.com, ola@example.com" className={`${control} py-2`} />
          </label>
          <div>
            <SubmitButton variant="secondary">Send invitations</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="delete" className={card}>
        <h2 id="delete" className="text-title text-ink">
          Delete the company
        </h2>
        <p className="text-sm text-muted">Only a company with no accounts can be deleted. Otherwise, remove the accounts, or switch the company off above.</p>
        <ActionForm action={deleteCompanyAction.bind(null, store.slug, company.id)}>
          <SubmitButton variant="secondary">Delete company</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
