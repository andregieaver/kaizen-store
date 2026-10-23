import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { LIMIT_KEYS, LIMITS, limitUnit, toTyped } from "@/lib/limits";
import { requirePlatformAdmin } from "@/server/auth";
import { limitGrid } from "@/server/limits-admin";

import { savePlanLimitsAction } from "./actions";

export const metadata: Metadata = { title: "Limits" };

/**
 * What each plan includes (D314, `docs/capacity.md` step 2.6): one row per limit, a column per active plan and the default. Empty means the
 * next source decides (the default, then unlimited); Unlimited is a row that means no limit. Traffic limits only ever warn.
 */
export default async function PlanLimitsPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const w = adminText(adminLangOf(admin.adminLocale), "capacity");
  const grid = await limitGrid();
  const columns = [{ id: "default", name: w.editor.default }, ...grid.plans];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.editor.title} description={w.editor.description} />
      <Card compact>
        <ActionForm action={savePlanLimitsAction} className="grid gap-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead className="text-caption text-muted">
                <tr>
                  <th scope="col" className="py-2 pr-4" />
                  {columns.map((c) => (
                    <th key={c.id} scope="col" className="py-2 pr-4">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {LIMIT_KEYS.map((key) => {
                  const unit = w.units[limitUnit(key)];
                  return (
                    <tr key={key}>
                      <th scope="row" className="py-2 pr-4 text-ink">
                        {w.limits[key]}
                        {unit && <span className="ml-1 text-caption text-muted">({unit})</span>}
                        {LIMITS[key].enforce === "soft" && <span className="block text-caption text-muted">{w.usage.softOver}</span>}
                      </th>
                      {columns.map((c) => {
                        const stored = grid.cells[c.id] ?? {};
                        const has = key in stored;
                        const value = stored[key];
                        return (
                          <td key={c.id} className="py-2 pr-4 align-top">
                            <div className="flex flex-col gap-1">
                              <input
                                name={`v:${c.id}:${key}`}
                                inputMode="decimal"
                                defaultValue={has && value != null ? toTyped(key, value) : ""}
                                aria-label={`${w.limits[key]}, ${c.name}`}
                                className="w-28 rounded-lg border border-edge bg-card px-2 py-1"
                              />
                              <label className="flex items-center gap-1 text-caption text-muted">
                                <input type="checkbox" name={`u:${c.id}:${key}`} defaultChecked={has && value === null} />
                                {w.editor.unlimited}
                              </label>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <SubmitButton>{w.editor.save}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
