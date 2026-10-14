import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CompanyFields } from "@/components/admin/company-fields";
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
  const [companies, groups] = await Promise.all([listCompanies(store.id), listTiers(store.id)]);
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Companies"
        description={<>A company&apos;s main account invites its employees by email from My account in the store. Everyone in the company gets its group&apos;s discount, employees the share you set.</>}
      />

      {companies.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line bg-card p-8 text-center text-sm text-muted">No companies yet.</p>
      ) : (
        <Card compact>
          <List label="Companies">
            {companies.map((company) => {
              const percent = employeePercent({ ...company });
              return (
                <ListRow key={company.id} href={`${base}/companies/${company.id}`}>
                  <RowLead
                    title={company.name}
                    sub={
                      <>
                        {company.tierName ? `${company.tierName} (${company.tierPercent} %)${company.tierActive ? "" : ", off"}` : "No group"}
                        {percent ? ` · employees get ${percent} %` : ""}
                      </>
                    }
                  />
                  <RowFact sub={company.pendingInvites > 0 ? `${company.pendingInvites} waiting` : undefined}>
                    {company.members} of {company.maxMembers} accounts
                  </RowFact>
                  <Chip signal={company.active ? "positive" : "neutral"} dot>
                    {company.active ? "Active" : "Switched off"}
                  </Chip>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}

      <Card title="New company" className="flex max-w-xl flex-col gap-3" compact>
        <ActionForm action={saveCompanyAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
          <CompanyFields
            groups={groups}
            main
            lookup={lookupRegisterCompanyAction.bind(null, store.slug)}
            search={searchRegisterCompaniesAction.bind(null, store.slug)}
          />
          <div>
            <SubmitButton>Make company</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
