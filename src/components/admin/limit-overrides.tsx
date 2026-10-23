import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import { LIMIT_KEYS, type LimitKey } from "@/lib/limits";
import { formatLimit } from "@/lib/usage-format";
import type { PanelAction, RowAction } from "@/lib/usage-view";

import { Card } from "./ui";

type Resolved = Record<LimitKey, { value: number | null; origin: "override" | "plan" | "platform" | "none" }>;

/**
 * A store's limits on the platform's store page (D314, `docs/capacity.md` step 2.6): each limit's value now and where it comes from,
 * the store's overrides with their reasons, and a form to set one. Figures are compared down a column, so a table.
 */
export function LimitOverridesCard({
  limits,
  overrides,
  words: w,
  locale,
  set,
  remove,
}: {
  limits: Resolved;
  overrides: readonly { id: string; key: LimitKey; reason: string; expiresAt: string | null }[];
  words: CapacityMessages;
  locale: string;
  set: PanelAction;
  remove: RowAction;
}) {
  const shown = (key: LimitKey) => (limits[key].value === null ? w.usage.noLimit : formatLimit(key, limits[key].value!, locale));
  return (
    <Card title={w.overrides.title} description={w.overrides.description} compact>
      <div className="grid gap-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-body">
            <thead className="text-caption text-muted">
              <tr>
                <th scope="col" className="py-1 pr-4">{w.overrides.limit}</th>
                <th scope="col" className="py-1 pr-4">{w.overrides.effective}</th>
                <th scope="col" className="py-1 pr-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {LIMIT_KEYS.map((key) => {
                const own = overrides.find((o) => o.key === key);
                return (
                  <tr key={key}>
                    <th scope="row" className="py-2 pr-4 text-ink">{w.limits[key]}</th>
                    <td className="py-2 pr-4 tabular-nums">
                      {shown(key)} <span className="text-caption text-muted">({w.overrides.from[limits[key].origin]})</span>
                      {own && (
                        <span className="block text-caption text-muted">
                          {own.reason}
                          {own.expiresAt ? ` · ${w.overrides.ends} ${own.expiresAt.slice(0, 10)}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {own && (
                        <ActionForm action={remove(own.id)}>
                          <SubmitButton variant="secondary">{w.overrides.remove}</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ActionForm action={set} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-body">
            {w.overrides.limit}
            <select name="key" className="rounded-lg border border-edge bg-card px-2 py-1">
              {LIMIT_KEYS.map((key) => (
                <option key={key} value={key}>{w.limits[key]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-body">
            {w.overrides.value}
            <input name="value" inputMode="decimal" className="w-28 rounded-lg border border-edge bg-card px-2 py-1" />
          </label>
          <label className="flex items-center gap-1 pb-2 text-body">
            <input type="checkbox" name="unlimited" />
            {w.editor.unlimited}
          </label>
          <label className="flex flex-col gap-1 text-body">
            {w.overrides.reason}
            <input name="reason" required minLength={3} maxLength={300} className="w-56 rounded-lg border border-edge bg-card px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-body">
            {w.overrides.ends}
            <input type="date" name="ends" className="rounded-lg border border-edge bg-card px-2 py-1" />
          </label>
          <SubmitButton>{w.overrides.set}</SubmitButton>
        </ActionForm>
      </div>
    </Card>
  );
}
