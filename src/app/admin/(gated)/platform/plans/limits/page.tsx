import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { LIMIT_KEYS, LIMITS, limitUnit, toTyped } from "@/lib/limits";
import { CAPACITY_WORDS } from "@/lib/admin-words/capacity";
import { requirePlatformReader } from "@/server/auth";
import { limitGrid } from "@/server/limits-admin";

import { savePlanLimitsAction } from "./actions";

export const metadata: Metadata = { title: "Limits" };

/**
 * What each plan includes (D314, `docs/capacity.md` step 2.6): one row per limit, a column per active plan and the default. Empty means the
 * next source decides (the default, then unlimited); Unlimited is a row that means no limit. Traffic limits only ever warn.
 */
export default async function PlanLimitsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const w = CAPACITY_WORDS[adminLangOf(admin.adminLocale)];
  const grid = await limitGrid();
  const columns = [{ id: "default", name: w.editor.default }, ...grid.plans];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.editor.title}
        description={
          <>
            <span className="sm:hidden">{w.editor.phoneLead}</span>
            <span className="max-sm:hidden">{w.editor.description}</span>
          </>
        }
      />
      <Card compact>
        <ActionForm action={savePlanLimitsAction} className="grid gap-4">
          {/* Round 70 (D846): on a phone the table is a list, each limit one row: its name, then each plan's field and Unlimited on its line
              (the plan's name above it when there is more than the default). The fields stay one set, so the form posts each value once. */}
          <div className="overflow-x-auto max-sm:overflow-visible">
            <table className="w-full text-left text-body max-sm:block">
              <thead className="text-caption text-muted max-sm:sr-only">
                <tr>
                  <th scope="col" className="py-2 pr-4" />
                  {columns.map((c) => (
                    <th key={c.id} scope="col" className="py-2 pr-4">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line max-sm:block">
                {LIMIT_KEYS.map((key) => {
                  const unit = w.units[limitUnit(key)];
                  return (
                    <tr key={key} className="max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:py-2">
                      <th scope="row" className="py-2 pr-4 text-ink max-sm:min-w-0 max-sm:flex-1 max-sm:basis-36 max-sm:p-0">
                        {w.limits[key]}
                        {unit && <span className="ml-1 text-caption text-muted">({unit})</span>}
                        {LIMITS[key].enforce === "soft" && (
                          <span className="block text-caption text-muted">
                            <span className="sm:hidden">{w.editor.phoneWarns}</span>
                            <span className="max-sm:hidden">{w.usage.softOver}</span>
                          </span>
                        )}
                      </th>
                      {columns.map((c) => {
                        const stored = grid.cells[c.id] ?? {};
                        const has = key in stored;
                        const value = stored[key];
                        return (
                          <td key={c.id} className="py-2 pr-4 align-top max-sm:p-0">
                            {columns.length > 1 && <span className="block text-caption text-muted sm:hidden">{c.name}</span>}
                            <div className="flex flex-col gap-1 max-sm:flex-row max-sm:items-center max-sm:gap-2">
                              <input
                                name={`v:${c.id}:${key}`}
                                inputMode="decimal"
                                defaultValue={has && value != null ? toTyped(key, value) : ""}
                                aria-label={`${w.limits[key]}, ${c.name}`}
                                className="w-28 rounded-lg border border-edge bg-card px-2 py-1 max-sm:w-20"
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
