import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { waitWords } from "@/lib/flow-story";
import type { FlowCondition, FlowStep } from "@/lib/flows";
import type { FlowsMessages } from "@/lib/admin-messages/flows.en";

import { addFlowStepAction, changeFlowConditionAction, removeFlowStepAction } from "../actions";

type Props = {
  storeSlug: string;
  flowId: string;
  locale: string;
  w: FlowsMessages;
  segments: ReadonlyArray<{ id: string; name: string }>;
};

const conditionValue = (c: FlowCondition) => (c.kind === "ordered_since_entry" ? "ordered" : c.kind === "clicked_flow_email" ? "clicked" : `segment:${c.segmentId}`);

/** One "Add" control: a button per kind, placed after a step or first in a branch. Buttons, not a list: one press adds the step. */
function AddStep({ p, place, label }: { p: Props; place: { afterId: string } | { into: string; branch: "then" | "else" }; label: string }) {
  return (
    <ActionForm action={addFlowStepAction.bind(null, p.storeSlug, p.flowId, place, p.locale, p.w.canvas.newEmail)}>
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2 text-caption text-muted">
        <span>
          {p.w.canvas.add} {label.charAt(0).toLocaleLowerCase() + label.slice(1)}:
        </span>
        {(["email", "wait", "if", "end"] as const).map((k) => (
          <SubmitButton key={k} variant="secondary" name="kind" value={k}>
            {p.w.canvas.kinds[k]}
          </SubmitButton>
        ))}
      </div>
    </ActionForm>
  );
}

/** The conditions an `if` may take, as the owner reads them. */
const conditions = ({ w, segments }: Props) => [
  { value: "ordered", label: w.story.conditions.ordered.yes },
  { value: "clicked", label: w.story.conditions.clicked.yes },
  ...segments.map((s) => ({ value: `segment:${s.id}`, label: w.story.conditions.segment.yes.replace("{segment}", s.name) })),
];

function stepTitle(step: FlowStep, p: Props): string {
  const { w } = p;
  if (step.kind === "if") return `${w.canvas.kinds.if}: ${conditions(p).find((c) => c.value === conditionValue(step.condition))?.label ?? ""}`;
  if (step.kind === "email") return `${w.canvas.kinds.email}: ${Object.values(step.content)[0]?.subject ?? ""}`;
  if (step.kind === "wait") return `${w.canvas.kinds.wait}: ${waitWords(step.hours, w.story)}`;
  return w.canvas.kinds[step.kind];
}

function StepList({ steps, p, depth }: { steps: readonly FlowStep[]; p: Props; depth: number }) {
  const { w } = p;
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => (
        <li key={step.id} className="flex flex-col gap-2" data-canvas-step={step.kind}>
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-card px-3 py-2" data-canvas-row>
            <p className="min-w-0 flex-1 text-sm font-medium text-ink">{stepTitle(step, p)}</p>
            {step.kind === "if" && (
              <ActionForm action={changeFlowConditionAction.bind(null, p.storeSlug, p.flowId, step.id)}>
                <div role="group" aria-label={w.canvas.condition} className="flex flex-wrap items-center gap-2">
                  {conditions(p)
                    .filter((c) => c.value !== conditionValue(step.condition))
                    .map((c) => (
                      <SubmitButton key={c.value} variant="secondary" name="condition" value={c.value}>
                        {c.label}
                      </SubmitButton>
                    ))}
                </div>
              </ActionForm>
            )}
            <ActionForm action={removeFlowStepAction.bind(null, p.storeSlug, p.flowId, step.id)}>
              <SubmitButton variant="secondary">{step.kind === "if" ? w.canvas.removeIf : w.canvas.remove}</SubmitButton>
            </ActionForm>
          </div>
          {step.kind === "if" && (
            <div className="flex flex-col gap-3 border-s-2 border-line ps-4">
              {(["then", "else"] as const).map((branch) => (
                <div key={branch} className="flex flex-col gap-2" data-canvas-branch={branch}>
                  <p className="text-caption font-medium text-ink-2">{branch === "then" ? w.canvas.yes : w.canvas.no}</p>
                  <AddStep p={p} place={{ into: step.id, branch }} label={branch === "then" ? w.canvas.addYes : w.canvas.addNo} />
                  <StepList steps={step[branch]} p={p} depth={depth + 1} />
                </div>
              ))}
            </div>
          )}
          <AddStep p={p} place={{ afterId: step.id }} label={w.canvas.addAfter} />
        </li>
      ))}
    </ol>
  );
}

/**
 * The canvas (D767 slice 2): every step of the flow as a tree, under Customise, one deliberate step from the story Homer reads. Each step
 * can be removed, an `if`'s condition changed, and a step of any kind added after it or first in a branch; every change saves a new
 * version switched off until tested, and the story above is drawn from the same tree.
 */
export function FlowCanvas({ steps, ...p }: Props & { steps: readonly FlowStep[] }) {
  return (
    <details className="rounded-panel border border-line bg-card px-4 py-3" data-flow-canvas>
      <summary className="cursor-pointer text-body-strong text-ink">{p.w.canvas.customise}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-caption text-muted">{p.w.canvas.lead}</p>
        <StepList steps={steps} p={p} depth={0} />
      </div>
    </details>
  );
}
