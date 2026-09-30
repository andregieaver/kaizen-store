import { featureGroups, type FeatureMatrix } from "@/lib/plan-features";

/**
 * The plans side by side (D132): every feature in a row grouped by category, every plan a column, a check where the plan
 * includes it. Read only, for store owners choosing a plan; `planIds` limits and orders the columns.
 */
export function PlanFeatureTable({ matrix, planIds, current }: { matrix: FeatureMatrix; planIds: string[]; current?: string | null }) {
  const columns = planIds.flatMap((id) => matrix.plans.filter((plan) => plan.id === id));
  const groups = featureGroups(matrix.features).filter((group) => group.features.length > 0);
  if (columns.length === 0 || groups.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <caption className="sr-only">What each plan includes</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-3 font-normal text-muted">
              Feature
            </th>
            {columns.map((plan) => (
              <th key={plan.id} scope="col" className="w-28 px-3 py-3 text-center font-medium">
                {plan.name}
                {plan.id === current && <span className="block text-xs font-normal text-muted">Your plan</span>}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.category}>
            <tr className="bg-surface">
              <th colSpan={columns.length + 1} scope="colgroup" className="px-4 py-1.5 text-left text-sm font-medium">
                {group.category}
              </th>
            </tr>
            {group.features.map((feature) => (
              <tr key={feature.id} className="border-t border-border">
                <th scope="row" className="px-4 py-2 text-left font-normal">
                  {feature.name}
                  {feature.description && <span className="block text-xs text-muted">{feature.description}</span>}
                </th>
                {columns.map((plan) => (
                  <td key={plan.id} className="px-3 py-2 text-center">
                    {feature.planIds.includes(plan.id) ? (
                      <>
                        <span aria-hidden className="font-semibold">✓</span>
                        <span className="sr-only">Included</span>
                      </>
                    ) : (
                      <>
                        <span aria-hidden className="text-muted">–</span>
                        <span className="sr-only">Not included</span>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
