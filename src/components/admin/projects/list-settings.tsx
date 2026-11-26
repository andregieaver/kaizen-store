"use client";

import { useOptimistic, useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { Select } from "@/components/admin/ui/field";
import { fillWords } from "@/lib/admin-fill";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";
import { BUILT_FEATURES, type AdvancedFeature, type ChecklistFeatures } from "@/lib/projects-features";

import { useAct, type ProjectsAct } from "./use-act";

type Mode = { isAdvanced: boolean; isRoutine: boolean; features: ChecklistFeatures };

/**
 * How a list works (D903, Life's checklist settings): *Advanced list* brings every field at once and its switches take away what this list
 * doesn't need (hidden, never deleted); *Routine* keeps a habit's order. Each switch is saved as it is turned. Below, the projects the list
 * is in, its home among them, and whether it uses the store's statuses or its own.
 */
export function ListSettings({
  listId,
  mode,
  stored,
  projects,
  homeId,
  addable,
  ownStatuses,
  canChange,
  words,
  act,
}: {
  listId: string;
  mode: Mode;
  /** The switches as kept (the list's own, before a routine's exclusions). */
  stored: ChecklistFeatures;
  projects: { id: string; name: string }[];
  homeId: string | null;
  addable: { id: string; name: string }[];
  ownStatuses: boolean;
  canChange: boolean;
  words: Pick<ProjectsMessages, "listSettings" | "delete">;
  act: ProjectsAct;
}) {
  const w = words.listSettings;
  const { run, said } = useAct(act);
  const [shown, change] = useOptimistic({ ...mode, features: stored }, (state, next: Partial<Mode>) => ({ ...state, ...next }));
  const [choice, setChoice] = useState("");

  const setFeature = (feature: AdvancedFeature, on: boolean) => {
    const features = { ...shown.features, [feature]: on };
    run({ op: "list.mode", id: listId, features }, undefined, () => change({ features }));
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="how" className="flex flex-col gap-3">
        <h2 id="how" className="text-title text-ink">
          {w.how}
        </h2>
        <Switch
          label={w.advanced}
          text={shown.isAdvanced ? w.advancedOn : w.advancedOff}
          on={shown.isAdvanced}
          disabled={!canChange}
          onChange={(on) => run({ op: "list.mode", id: listId, isAdvanced: on }, undefined, () => change({ isAdvanced: on }))}
        />
        {shown.isAdvanced && (
          <fieldset className="flex flex-col gap-2 rounded-panel bg-sunken p-4">
            <legend className="sr-only">{w.fields}</legend>
            <p className="text-sm text-muted">{w.hiddenKept}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {BUILT_FEATURES.map((feature) => (
                <label key={feature} className="flex items-center gap-2 text-body text-ink">
                  <input type="checkbox" checked={shown.features[feature]} disabled={!canChange} onChange={(e) => setFeature(feature, e.target.checked)} className="size-4 accent-brand" />
                  {w.fieldNames[feature]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Switch
          label={w.routine}
          text={w.routineText}
          on={shown.isRoutine}
          disabled={!canChange}
          onChange={(on) => run({ op: "list.mode", id: listId, isRoutine: on }, undefined, () => change({ isRoutine: on }))}
        />
      </section>

      <section aria-labelledby="in-projects" className="flex flex-col gap-3">
        <h2 id="in-projects" className="text-title text-ink">
          {w.projects}
        </h2>
        <p className="text-sm text-muted">{w.projectsText}</p>
        {projects.length === 0 ? (
          <p className="text-body text-ink-2">{w.noProjects}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-panel border border-line bg-card">
            {projects.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-body text-ink">{p.name}</span>
                {p.id === homeId ? (
                  <span className="text-chip text-ink-2">{w.homeLabel}</span>
                ) : (
                  canChange && (
                    <Button size="dense" kind="quiet" onClick={() => run({ op: "list.mode", id: listId, primaryProjectId: p.id })}>
                      {fillWords(w.makeHome, { name: p.name })}
                    </Button>
                  )
                )}
                {canChange && (
                  <Button size="dense" kind="quiet" onClick={() => run({ op: "project.unlink", projectId: p.id, checklistId: listId })}>
                    {fillWords(w.takeOut, { name: p.name })}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canChange && addable.length > 0 && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (choice) run({ op: "project.link", projectId: choice, checklistId: listId }, (answer) => answer.ok && setChoice(""));
            }}
          >
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
              {w.addTo}
              <Select value={choice} onChange={(e) => setChoice(e.target.value)} full>
                <option value="" />
                {addable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" disabled={!choice}>
              {w.addTo}
            </Button>
          </form>
        )}
      </section>

      <section aria-labelledby="statuses" className="flex flex-col gap-3">
        <h2 id="statuses" className="text-title text-ink">
          {w.statuses}
        </h2>
        <p className="text-sm text-muted">{ownStatuses ? w.statusesOwn : w.statusesStore}</p>
        {canChange &&
          (ownStatuses ? (
            <ConfirmButton kind="secondary" className="self-start" danger={false} question={w.useStoreConfirm} confirm={w.useStore} action={() => run({ op: "status.useStore", kind: "checklist", scopeId: listId })}>
              {w.useStore}
            </ConfirmButton>
          ) : (
            <Button className="self-start" onClick={() => run({ op: "status.useOwn", kind: "checklist", scopeId: listId })}>
              {w.useOwn}
            </Button>
          ))}
      </section>

      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </div>
  );
}

/** A labelled switch with a sentence on what it does. */
function Switch({ label, text, on, disabled, onChange }: { label: string; text: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 rounded-panel border border-line bg-card p-4">
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-brand" />
      <span className="flex flex-col gap-1">
        <span className="text-body-strong text-ink">{label}</span>
        <span className="text-sm text-muted">{text}</span>
      </span>
    </label>
  );
}
