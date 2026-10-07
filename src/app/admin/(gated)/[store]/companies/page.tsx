import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CompanyFields } from "@/components/admin/company-fields";
import { requirePermission } from "@/server/permissions";
import { listCompanies, employeePercent } from "@/server/companies";
import { listTiers } from "@/server/customer-tiers";

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
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted">
          A company&apos;s main account invites its employees by email from My account in the store. Everyone in the company gets its group&apos;s discount, employees the share you set.
        </p>
      </div>

      {companies.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">No companies yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Company</th>
                <th scope="col" className="px-4 py-2 font-medium">Group</th>
                <th scope="col" className="px-4 py-2 font-medium">Employees get</th>
                <th scope="col" className="px-4 py-2 font-medium">Accounts</th>
                <th scope="col" className="px-4 py-2 font-medium">Waiting</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => {
                const percent = employeePercent({ ...company });
                return (
                  <tr key={company.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`${base}/companies/${company.id}`} className="font-medium underline-offset-2 hover:underline">
                        {company.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{company.tierName ? `${company.tierName} (${company.tierPercent} %)${company.tierActive ? "" : ", off"}` : "None"}</td>
                    <td className="px-4 py-2 tabular-nums">{percent ? `${percent} %` : "–"}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {company.members}/{company.maxMembers}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{company.pendingInvites}</td>
                    <td className="px-4 py-2">{company.active ? "Active" : "Switched off"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section aria-labelledby="new-company" className="flex max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h2 id="new-company" className="font-medium">
          New company
        </h2>
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
      </section>
    </div>
  );
}
