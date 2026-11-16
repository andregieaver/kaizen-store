import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CompanyFields } from "@/components/admin/company-fields";
import { countWords, fillWords } from "@/lib/admin-fill";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { listCompanies, employeePercent } from "@/server/companies";
import { listTiers } from "@/server/customer-tiers";
import { Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

import { lookupRegisterCompanyAction, saveCompanyAction, searchRegisterCompaniesAction } from "./actions";

export const metadata: Metadata = { title: "Companies" };

/**
 * Companies that buy from the store (D108): a company has a customer group,
 * a main account that invites its employees, and a share of the group's
 * discount that employees get.
 */
export default async function CompaniesPage({ params }: PageProps<"/admin/[store]/companies">) {
  const current = await requirePermission((await params).store, "customers:read");
  const off = requireFeature(current, "business");
  if (off) return off;
  const { store } = current;
  const all = adminText(adminLangOf(current.account.adminLocale), "customers");
  const words = all.companies;
  const [companies, groups] = await Promise.all([listCompanies(store.id), listTiers(store.id)]);
  const base = `/admin/${store.slug}`;

  return (
    <AdminTextScope texts={adminTexts(adminLangOf(current.account.adminLocale), ["bookings"])}>
    <div className="flex flex-col gap-8">
      {/* Round 14 (D641): a sentence; a new company asked for by its number first, the register filling in the rest. */}
      <PageHeader
        title={words.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{companies.length === 0 ? words.leadNone : countWords(companies.length, words.leadSome)}</span>
            {words.leadRest}
          </span>,
        ]}
      />

      {companies.length > 0 && (
        <Card compact>
          <List label={words.title}>
            {companies.map((company) => {
              const percent = employeePercent({ ...company });
              return (
                <ListRow key={company.id} href={`${base}/companies/${company.id}`}>
                  <RowLead
                    title={company.name}
                    sub={
                      <>
                        {company.tierName ? `${company.tierName} (${company.tierPercent} %)${company.tierActive ? "" : words.off}` : words.noGroup}
                        {percent ? fillWords(words.employeesGet, { percent }) : ""}
                      </>
                    }
                  />
                  <RowFact sub={company.pendingInvites > 0 ? fillWords(words.waiting, { n: company.pendingInvites }) : undefined}>
                    {fillWords(words.accounts, { members: company.members, max: company.maxMembers })}
                  </RowFact>
                  <Chip signal={company.active ? "positive" : "neutral"} dot>
                    {company.active ? words.active : words.switchedOff}
                  </Chip>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}

      <Card title={words.add} className="flex max-w-xl flex-col gap-3" compact>
        <ActionForm action={saveCompanyAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
          <CompanyFields
            groups={groups}
            main
            words={all.fields}
            lookup={lookupRegisterCompanyAction.bind(null, store.slug)}
            search={searchRegisterCompaniesAction.bind(null, store.slug)}
            stepped
            submit={
              <div>
                <SubmitButton>{words.make}</SubmitButton>
              </div>
            }
          />
        </ActionForm>
      </Card>
    </div>
    </AdminTextScope>
  );
}
