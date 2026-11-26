import type { ReactNode } from "react";

import { Field, Select } from "@/components/admin/ui/field";

import type { ProjectColour, ProjectHealth, ProjectStatus } from "@/lib/projects-model";

/**
 * Small parts of Projects and checklists (D903) shared by the server pages and the client parts: a colour as the admin's scheme draws it
 * (a signal's solid fill or a chart tone, `src/lib/admin-schemes.ts`), so a colour chosen once reads in every scheme, and a status's chip.
 */

/** The colour of a project's state: blocked is danger, done positive, planning insight, the rest neutral. */
export const projectStatusColour = (status: ProjectStatus): ProjectColour =>
  status === "blocked" ? "danger" : status === "done" ? "positive" : status === "planning" ? "insight" : "neutral";

/** The colour of a project's health: on track, at risk, off track. */
export const healthColour = (health: ProjectHealth): ProjectColour => (health === "green" ? "positive" : health === "amber" ? "warning" : "danger");

/** The custom property a palette key is drawn with. */
export const colourVar = (colour: ProjectColour): string => (colour.startsWith("chart-") ? `var(--${colour})` : `var(--${colour}-solid)`);

/** A colour's dot, beside its words (never alone). */
export function ColourDot({ colour, size = "size-2.5" }: { colour: ProjectColour; size?: string }) {
  return <span aria-hidden className={`inline-block shrink-0 rounded-full ${size}`} style={{ backgroundColor: colourVar(colour) }} />;
}

/** A status, a stage or a project state as a quiet chip with its colour's dot. */
export function StatusPill({ colour, children }: { colour: ProjectColour; children: ReactNode }) {
  return (
    <span className="inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-pill bg-sunken px-2.5 text-chip whitespace-nowrap text-ink-2">
      <ColourDot colour={colour} size="size-2" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** A project's status bar: each part as wide as its share, in its status's colour, with the counts in words for screen readers. */
export function StatusBarView({ parts, label }: { parts: { id: string; name: string; colour: ProjectColour; count: number }[]; label: string }) {
  const total = parts.reduce((sum, p) => sum + p.count, 0);
  if (total === 0) return null;
  return (
    <div role="img" aria-label={`${label}: ${parts.map((p) => `${p.name} ${p.count}`).join(", ")}`} className="flex h-2 w-full overflow-hidden rounded-pill bg-sunken">
      {parts.map((p) => (
        <span key={p.id} style={{ width: `${(p.count / total) * 100}%`, backgroundColor: colourVar(p.colour) }} />
      ))}
    </div>
  );
}

/** A labelled choice of a form, sent as `name`: a settings page's status, health, colour, state or person. */
export function ChoiceField({ label, name, value, options, disabled }: { label: string; name: string; value: string; options: readonly { value: string; label: string }[]; disabled: boolean }) {
  return (
    <Field label={label}>
      {(control) => (
        <Select {...control} name={name} defaultValue={value} disabled={disabled} full>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
