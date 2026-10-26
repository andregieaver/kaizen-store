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
import { PAYMENT_TERMS } from "@/lib/payment-terms";
import { countWords, fillWords } from "@/lib/admin-fill";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formatPriceInput } from "@/lib/product-input";
import { listTiers } from "@/server/customer-tiers";
import { listLocations } from "@/server/company-locations";

import { LocationsCard } from "./locations-card";
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
  const all = adminText(adminLangOf(current.account.adminLocale), "customers");
  const words = all.company;
  if (!z.uuid().safeParse(companyId).success) notFound();
  const company = await getCompany(store.id, companyId);
  if (!company) notFound();
  const [groups, members, invites, owes, locations] = await Promise.all([
    listTiers(store.id),
    listMembers(store.id, company.id),
    listInvites(store.id, company.id),
    companyOwes(store.id, company.id),
    listLocations(store.id, company.id),
  ]);
  const currency = mainCurrency(store);
  const base = `/admin/${store.slug}`;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const employees = employeePercent(company);

  return (
    <AdminTextScope texts={adminTexts(adminLangOf(current.account.adminLocale), ["bookings"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/companies`, label: words.back }}
        title={<>{company.name}</>}
        description={
          !company.active
            ? words.off
            : company.tierName && company.tierActive
              ? fillWords(employees ? words.discount : words.discountNoEmployees, { group: company.tierName, percent: company.tierPercent ?? 0, employees: employees ?? 0 })
              : words.noDiscount
        }
      />

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className="text-title text-ink">
          {words.settings}
        </h2>
        <ActionForm action={saveCompanyAction.bind(null, store.slug, company.id)} className="flex flex-col gap-3">
          <CompanyFields
            groups={groups}
            values={company}
            words={all.fields}
            lookup={lookupRegisterCompanyAction.bind(null, store.slug)}
            search={searchRegisterCompaniesAction.bind(null, store.slug)}
          />
          <div>
            <SubmitButton>{words.save}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="terms" className={card}>
        <h2 id="terms" className="text-title text-ink">
          {words.terms}
        </h2>
        <p className="text-sm text-muted">
          {words.termsIntro}
        </p>
        {owes.length > 0 && (
          <p className="text-sm text-ink">
            {words.owesNow}
            {owes
              .map(
                (o) =>
                  countWords(o.orders, words.owesLine, { amount: formatMoney(o.owedMinor, o.currency, locale) }) +
                  (o.overdueMinor > 0 ? fillWords(words.overdue, { amount: formatMoney(o.overdueMinor, o.currency, locale) }) : ""),
              )
              .join("; ")}
          </p>
        )}
        <ActionForm action={saveCompanyTermsAction.bind(null, store.slug, company.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.termsField}
            <select name="terms" defaultValue={company.paymentTerms ?? ""} className={`${control} max-w-xs`}>
              <option value="">{words.noTerms}</option>
              {PAYMENT_TERMS.map((terms) => (
                <option key={terms} value={terms}>
                  {words.termsLabels[terms]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {fillWords(words.creditLimit, { currency })}
            <input
              name="creditLimit"
              inputMode="decimal"
              defaultValue={company.creditLimitMinor === null ? "" : formatPriceInput(company.creditLimitMinor, company.creditCurrency ?? currency)}
              className={`${control} max-w-xs`}
            />
            <span className="font-normal text-muted">
              {words.creditHint}
              {company.creditCurrency && company.creditCurrency !== currency ? fillWords(words.keptIn, { currency: company.creditCurrency }) : ""}
            </span>
          </label>
          <div>
            <SubmitButton>{words.saveTerms}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="accounts" className={card}>
        <h2 id="accounts" className="text-title text-ink">
          {fillWords(words.accounts, { members: members.length, max: company.maxMembers })}
        </h2>
        {members.length === 0 ? (
          <p className="text-sm text-muted">{words.noAccounts}</p>
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
                    {member.role === "owner" ? words.mainAccount : words.employee}
                    {fillWords(words.since, { date: date(member.joinedAt) })}
                    {member.verified ? "" : words.notSignedIn}
                  </span>
                </span>
                <ActionForm action={removeCompanyMemberAction.bind(null, store.slug, company.id)} className="flex items-center">
                  <input type="hidden" name="customerId" value={member.id} />
                  <SubmitButton variant="secondary">
                    {words.remove}<span className="sr-only"> {member.email}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <ActionForm action={setMainAccountAction.bind(null, store.slug, company.id)} className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.addMain}
            <span className="flex flex-wrap gap-2">
              <input type="email" name="email" required className={`${control} min-w-64 flex-1`} />
              <SubmitButton variant="secondary">{words.add}</SubmitButton>
            </span>
            <span className="font-normal text-muted">{words.addMainHint}</span>
          </label>
        </ActionForm>
      </section>

      <section aria-labelledby="invitations" className={card}>
        <h2 id="invitations" className="text-title text-ink">
          {words.invitations}
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">{words.noneYet}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {invites.map((invite) => {
              const open = invite.status === "pending" && !invite.expired;
              const label = invite.status === "pending" ? (invite.expired ? words.inviteStatus.expired : words.inviteStatus.waiting) : words.inviteStatus[invite.status];
              return (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{invite.email}</span>
                    <span className="block text-muted">
                      {label}
                      {fillWords(words.sent, { date: date(invite.createdAt) })}
                      {open ? fillWords(words.validUntil, { date: date(invite.expiresAt) }) : ""}
                    </span>
                  </span>
                  {open && (
                    <ActionForm action={revokeCompanyInviteAction.bind(null, store.slug, company.id)} className="flex items-center">
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <SubmitButton variant="secondary">
                        {words.withdraw}<span className="sr-only">{fillWords(words.withdrawFor, { email: invite.email })}</span>
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
            {words.invite}
            <textarea name="emails" rows={2} required placeholder="anna@example.com, ola@example.com" className={`${control} py-2`} />
          </label>
          <div>
            <SubmitButton variant="secondary">{words.sendInvitations}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <LocationsCard
        lang={adminLangOf(current.account.adminLocale)}
        storeSlug={store.slug}
        companyId={company.id}
        locations={locations}
        members={members}
        rules={{
          poRequired: company.poRequired,
          limit: company.approvalLimitMinor !== null && company.approvalCurrency ? formatPriceInput(company.approvalLimitMinor, company.approvalCurrency) : "",
          currency: company.approvalCurrency ?? currency,
        }}
      />

      <section aria-labelledby="delete" className={card}>
        <h2 id="delete" className="text-title text-ink">
          {words.delete}
        </h2>
        <p className="text-sm text-muted">{words.deleteHint}</p>
        <ActionForm action={deleteCompanyAction.bind(null, store.slug, company.id)}>
          <SubmitButton variant="secondary">{words.deleteButton}</SubmitButton>
        </ActionForm>
      </section>
    </div>
    </AdminTextScope>
  );
}
