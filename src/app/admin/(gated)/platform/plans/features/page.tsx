import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { featureGroups, NEW_FEATURE_ROWS } from "@/lib/plan-features";
import { requirePlatformAdmin } from "@/server/auth";
import { getFeatureMatrix } from "@/server/plan-features";

import { saveFeaturesAction } from "./actions";

export const metadata: Metadata = { title: "Plan features" };

const input = "min-h-9 w-full rounded-md border border-border bg-background px-2 text-sm font-normal";

/**
 * The plan comparison (D132): every feature in a row, every active plan a column, a box to tick where the plan includes
 * it. Store owners see the same table, read only, when they choose a plan.
 */
export default async function PlanFeaturesPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { plans, features } = await getFeatureMatrix();
  const columns = plans.filter((plan) => plan.active);
  const groups = featureGroups(features);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/admin/platform/plans" className="w-fit text-sm underline">
          Plans
        </Link>
        <h1 className="text-2xl font-semibold">Plan features</h1>
        <p className="max-w-2xl text-sm text-muted">
          Tick what each plan includes. The list is what store owners compare when they choose a plan; it describes the
          plans and does not switch anything on or off. Give a feature a category to group it, a number to place it, and
          tick Remove to take it out.
        </p>
      </div>

      {columns.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-5 text-sm text-muted">
          There is no active plan yet. Make one under <Link href="/admin/platform/plans" className="underline">Plans</Link>,
          then come back to say what it includes.
        </p>
      ) : (
        <ActionForm action={saveFeaturesAction} className="flex flex-col gap-4">
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    Feature
                  </th>
                  <th scope="col" className="w-44 px-3 py-2 font-normal">
                    Category
                  </th>
                  <th scope="col" className="w-20 px-3 py-2 font-normal">
                    Place
                  </th>
                  {columns.map((plan) => (
                    <th key={plan.id} scope="col" className="w-24 px-3 py-2 text-center font-medium text-foreground">
                      {plan.name}
                    </th>
                  ))}
                  <th scope="col" className="w-20 px-3 py-2 text-center font-normal">
                    Remove
                  </th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.category} className="border-b border-border last:border-0">
                  <tr className="bg-surface">
                    <th colSpan={columns.length + 4} scope="colgroup" className="px-3 py-1.5 text-left text-sm font-medium">
                      {group.category}
                    </th>
                  </tr>
                  {group.features.map((feature) => (
                    <tr key={feature.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <input
                          name={`f:${feature.id}:name`}
                          defaultValue={feature.name}
                          aria-label={`Name of ${feature.name}`}
                          maxLength={80}
                          className={`${input} font-medium`}
                        />
                        <input
                          name={`f:${feature.id}:description`}
                          defaultValue={feature.description}
                          aria-label={`Description of ${feature.name}`}
                          maxLength={300}
                          placeholder="A line about it"
                          className={`${input} mt-1 text-muted`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          name={`f:${feature.id}:category`}
                          defaultValue={feature.category}
                          aria-label={`Category of ${feature.name}`}
                          maxLength={60}
                          className={input}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          name={`f:${feature.id}:position`}
                          defaultValue={feature.position}
                          aria-label={`Place of ${feature.name}`}
                          className={input}
                        />
                      </td>
                      {columns.map((plan) => (
                        <td key={plan.id} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            name={`g:${feature.id}:${plan.id}`}
                            defaultChecked={feature.planIds.includes(plan.id)}
                            aria-label={`${plan.name} includes ${feature.name}`}
                            className="size-5"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          name={`f:${feature.id}:remove`}
                          aria-label={`Remove ${feature.name}`}
                          className="size-5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tbody>
                <tr className="bg-surface">
                  <th colSpan={columns.length + 4} scope="colgroup" className="px-3 py-1.5 text-left text-sm font-medium">
                    New features
                  </th>
                </tr>
                {Array.from({ length: NEW_FEATURE_ROWS }, (_, i) => (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <input name={`n:${i}:name`} aria-label={`New feature ${i + 1}: name`} maxLength={80} placeholder="Name" className={input} />
                      <input
                        name={`n:${i}:description`}
                        aria-label={`New feature ${i + 1}: description`}
                        maxLength={300}
                        placeholder="A line about it"
                        className={`${input} mt-1`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        name={`n:${i}:category`}
                        aria-label={`New feature ${i + 1}: category`}
                        maxLength={60}
                        defaultValue={groups.at(-1)?.category ?? ""}
                        list="feature-categories"
                        className={input}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        name={`n:${i}:position`}
                        defaultValue={(features.at(-1)?.position ?? 0) + 10 * (i + 1)}
                        aria-label={`New feature ${i + 1}: place`}
                        className={input}
                      />
                    </td>
                    {columns.map((plan) => (
                      <td key={plan.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          name={`n:${i}:g:${plan.id}`}
                          aria-label={`${plan.name} includes new feature ${i + 1}`}
                          className="size-5"
                        />
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="feature-categories">
              {groups.map((group) => (
                <option key={group.category} value={group.category} />
              ))}
            </datalist>
          </div>
          <div>
            <SubmitButton>Save plan features</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
