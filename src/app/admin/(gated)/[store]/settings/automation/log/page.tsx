import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { RuleLog } from "@/components/admin/automation/rule-log";
import { PageHeader } from "@/components/admin/ui";
import { listRules, ruleLog } from "@/server/order-rules";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Automation log" };

const PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the automation rules did (wave 3, D238, 2.5 point 3): the runs of the last twelve months, by rule and by matched or not, a hundred at a time.
 * `settings:read`. The filters are the address (`rule`, `matched`, `before`), read here and checked; anything else is ignored.
 */
export default async function AutomationLogPage({ params, searchParams }: PageProps<"/admin/[store]/settings/automation/log">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const query = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const ruleId = one(query.rule) && UUID.test(one(query.rule)!) ? one(query.rule)! : null;
  const matched = one(query.matched) === "yes" ? true : one(query.matched) === "no" ? false : null;
  const beforeText = one(query.before);
  const before = beforeText && !Number.isNaN(Date.parse(beforeText)) ? new Date(beforeText).toISOString() : null;
  const [rules, runs] = await Promise.all([listRules(store.id), ruleLog(store.id, { ruleId, matched, before, limit: PAGE + 1 })]);
  const shown = runs.slice(0, PAGE);
  const base = `/admin/${store.slug}/settings/automation`;
  const params2 = (extra: Record<string, string | null>) => {
    const search = new URLSearchParams();
    const all = { rule: ruleId, matched: matched === null ? null : matched ? "yes" : "no", ...extra };
    for (const [k, v] of Object.entries(all)) if (v) search.set(k, v);
    const text = search.toString();
    return `${base}/log${text ? `?${text}` : ""}`;
  };
  const more = runs.length > PAGE ? params2({ before: shown[shown.length - 1].at }) : null;
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: "Automation" }} title="Automation log" description={<>Every time a rule ran for a paid order in the last twelve months, newest first. A rule runs once for each order; runs are never repeated.</>} />
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Rule
          <select name="rule" defaultValue={ruleId ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm">
            <option value="">All rules</option>
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Matched
          <select name="matched" defaultValue={matched === null ? "" : matched ? "yes" : "no"} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm">
            <option value="">Both</option>
            <option value="yes">Matched</option>
            <option value="no">Did not match</option>
          </select>
        </label>
        <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
          Show
        </button>
      </form>
      <RuleLog runs={shown} base={`/admin/${store.slug}`} when={when} more={more} />
    </div>
  );
}
