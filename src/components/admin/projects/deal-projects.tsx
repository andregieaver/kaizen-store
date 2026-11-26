"use client";

import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { EmptyState } from "@/components/admin/ui/empty-state";
import { Field, Select } from "@/components/admin/ui/field";
import { AdminLink } from "@/components/admin/ui/link";
import type { ProjectSourcesMessages } from "@/lib/admin-messages/project-sources.en";

import { useAct, type ProjectsAct } from "./use-act";

/**
 * A deal's projects (D904 P8.3b): a pair of the octopus, drawn by the deal's page only while the store has Projects too. Each project the
 * deal started links to it; once the deal is won, *Start a project* makes one named after the deal, empty or from a template list.
 */
export function DealProjects({
  base,
  dealId,
  won,
  projects,
  templates,
  canStart,
  words,
  act,
}: {
  base: string;
  dealId: string;
  won: boolean;
  projects: { id: string; name: string }[];
  templates: { id: string; title: string }[];
  canStart: boolean;
  words: ProjectSourcesMessages;
  act: ProjectsAct;
}) {
  const w = words.deal;
  const { run, pending, said } = useAct(act);
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState("");
  const starts = canStart && won;

  return (
    <section aria-labelledby="deal-projects" className="rounded-lg border border-line bg-card p-5 text-sm" data-deal-projects>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="deal-projects" className="text-title text-ink">
          {w.heading}
        </h2>
        {starts && !open && (
          <Button kind="quiet" size="dense" onClick={() => setOpen(true)}>
            {w.start}
          </Button>
        )}
      </div>
      {projects.length === 0 && !open && <EmptyState compact title={w.none} />}
      {projects.length > 0 && (
        <ul className="flex flex-col gap-1">
          {projects.map((p) => (
            <li key={p.id}>
              <AdminLink href={`${base}/projects/${p.id}`} className="underline underline-offset-2">
                {p.name}
              </AdminLink>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run({ op: "project.fromDeal", dealId, templateId: template || null }, (answer) => {
              if (answer.ok) setOpen(false);
            });
          }}
        >
          <p className="text-muted">{w.hint}</p>
          {templates.length > 0 && (
            <Field label={w.from}>
              {(control) => (
                <Select {...control} value={template} onChange={(e) => setTemplate(e.target.value)} full>
                  <option value="">{w.empty}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex gap-2">
            <Button kind="main" size="dense" type="submit" disabled={pending}>
              {w.go}
            </Button>
            <Button kind="quiet" size="dense" onClick={() => setOpen(false)}>
              {words.cancel}
            </Button>
          </div>
        </form>
      )}
      <p role="status" aria-live="polite" className="text-sm text-danger-text">
        {said}
      </p>
    </section>
  );
}
