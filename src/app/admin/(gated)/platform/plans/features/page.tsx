import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { featureGroups, NEW_FEATURE_ROWS } from "@/lib/plan-features";
import { requirePlatformAdmin } from "@/server/auth";
import { getFeatureMatrix } from "@/server/plan-features";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { saveFeaturesAction } from "./actions";

export const metadata: Metadata = { title: "Plan features" };

const input = "min-h-9 w-full rounded-md border border-line bg-card px-2 text-sm font-normal";

/**
 * The plan comparison (D132): every feature in a row, every active plan a column, a box to tick where the plan includes
 * it. Store owners see the same table, read only, when they choose a plan.
 */
export default async function PlanFeaturesPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const w = adminText(adminLangOf(account.adminLocale), "platform").features;
  const { plans, features } = await getFeatureMatrix();
  const columns = plans.filter((plan) => plan.active);
  const groups = featureGroups(features);

  return (
    <>
      <PageHeader
        back={{ href: "/admin/platform/plans", label: w.plans }}
        title={w.title}
        description={w.description}
      />

      {columns.length === 0 ? (
        <p className={`p-5 text-sm text-muted ${CARD_CLASS}`}>
          {w.noPlan} <Link href="/admin/platform/plans" className="underline">{w.plans}</Link>
          {w.noPlanAfter}
        </p>
      ) : (
        <ActionForm action={saveFeaturesAction} className="flex flex-col gap-4">
          <div className={`overflow-x-auto ${CARD_CLASS}`}>
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-3 py-2 font-normal">
                    {w.feature}
                  </th>
                  <th scope="col" className="w-44 px-3 py-2 font-normal">
                    {w.category}
                  </th>
                  <th scope="col" className="w-20 px-3 py-2 font-normal">
                    {w.place}
                  </th>
                  {columns.map((plan) => (
                    <th key={plan.id} scope="col" className="w-24 px-3 py-2 text-center font-medium text-ink">
                      {plan.name}
                    </th>
                  ))}
                  <th scope="col" className="w-20 px-3 py-2 text-center font-normal">
                    {w.remove}
                  </th>
                </tr>
              </thead>
              {groups.map((group) => (
                <tbody key={group.category} className="border-b border-line last:border-0">
                  <tr className="bg-sunken">
                    <th colSpan={columns.length + 4} scope="colgroup" className="px-3 py-1.5 text-left text-sm font-medium">
                      {group.category}
                    </th>
                  </tr>
                  {group.features.map((feature) => (
                    <tr key={feature.id} className="border-t border-line align-top">
                      <td className="px-3 py-2">
                        <input
                          name={`f:${feature.id}:name`}
                          defaultValue={feature.name}
                          aria-label={fillWords(w.nameOf, { name: feature.name })}
                          maxLength={80}
                          className={`${input} font-medium`}
                        />
                        <input
                          name={`f:${feature.id}:description`}
                          defaultValue={feature.description}
                          aria-label={fillWords(w.descriptionOf, { name: feature.name })}
                          maxLength={300}
                          placeholder={w.aLine}
                          className={`${input} mt-1 text-muted`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          name={`f:${feature.id}:category`}
                          defaultValue={feature.category}
                          aria-label={fillWords(w.categoryOf, { name: feature.name })}
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
                          aria-label={fillWords(w.placeOf, { name: feature.name })}
                          className={input}
                        />
                      </td>
                      {columns.map((plan) => (
                        <td key={plan.id} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            name={`g:${feature.id}:${plan.id}`}
                            defaultChecked={feature.planIds.includes(plan.id)}
                            aria-label={fillWords(w.includes, { plan: plan.name, name: feature.name })}
                            className="size-5"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          name={`f:${feature.id}:remove`}
                          aria-label={fillWords(w.removeOf, { name: feature.name })}
                          className="size-5"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tbody>
                <tr className="bg-sunken">
                  <th colSpan={columns.length + 4} scope="colgroup" className="px-3 py-1.5 text-left text-sm font-medium">
                    {w.newFeatures}
                  </th>
                </tr>
                {Array.from({ length: NEW_FEATURE_ROWS }, (_, i) => (
                  <tr key={i} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <input name={`n:${i}:name`} aria-label={fillWords(w.newName, { n: i + 1 })} maxLength={80} placeholder={w.name} className={input} />
                      <input
                        name={`n:${i}:description`}
                        aria-label={fillWords(w.newDescription, { n: i + 1 })}
                        maxLength={300}
                        placeholder={w.aLine}
                        className={`${input} mt-1`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        name={`n:${i}:category`}
                        aria-label={fillWords(w.newCategory, { n: i + 1 })}
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
                        aria-label={fillWords(w.newPlace, { n: i + 1 })}
                        className={input}
                      />
                    </td>
                    {columns.map((plan) => (
                      <td key={plan.id} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          name={`n:${i}:g:${plan.id}`}
                          aria-label={fillWords(w.newIncludes, { plan: plan.name, n: i + 1 })}
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
            <SubmitButton>{w.save}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
