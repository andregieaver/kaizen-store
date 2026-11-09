import { PLATFORM_EVENTS, type PlatformEvent } from "./platform-integrations";
import { workflowSchemaFor, type WorkflowActionKind, type WorkflowField, type WorkflowKit } from "./workflows";

/**
 * Workflows on Kaizena Flow's own events (C4 step 3 of `docs/platform-parity-plan.md`, D516): the store's workflows (D356) for the platform.
 * A trigger is one of the platform's events (D465: a store requested, made or opened, a plan started, changed, cancelled or not paid, a notice
 * of illegal content) or a schedule; conditions test the event's fields as the platform's endpoints get them (D515); the actions are the ones
 * that make sense for the platform: an email to its owners, a message in its Slack, a signed request to one of its own endpoints. The same
 * rules as a store's: saved off, switched on only after a test of the version saved, run once per event, at most `RUNS_PER_HOUR` an hour.
 * Nothing here reads the database.
 */

export type PlatformWorkflowTrigger = PlatformEvent | "schedule";
export const PLATFORM_WORKFLOW_TRIGGERS: readonly PlatformWorkflowTrigger[] = [...PLATFORM_EVENTS, "schedule"];
export const isPlatformWorkflowTrigger = (value: string): value is PlatformWorkflowTrigger => (PLATFORM_WORKFLOW_TRIGGERS as readonly string[]).includes(value);

/** What a platform event is about: the key its data is under in the payload (`request`, `store` with its `plan`, `report`). */
export function platformSubjectOf(trigger: PlatformWorkflowTrigger): "request" | "store" | "plan" | "report" | "schedule" {
  if (trigger === "schedule") return "schedule";
  if (trigger === "request.received") return "request";
  if (trigger === "report.received") return "report";
  if (trigger.startsWith("plan.")) return "plan";
  return "store";
}

/** The fields a condition may test, by what the event is about: paths into the payload (amounts in the currency's units). */
export const PLATFORM_WORKFLOW_FIELDS: Record<ReturnType<typeof platformSubjectOf>, WorkflowField[]> = {
  request: [
    { key: "request.store_name", kind: "text" },
    { key: "request.language", kind: "text" },
    { key: "request.domain", kind: "text" },
  ],
  store: [
    { key: "store.country", kind: "text" },
    { key: "store.slug", kind: "text" },
  ],
  plan: [
    { key: "plan.name", kind: "text" },
    { key: "plan.interval", kind: "text" },
    { key: "plan.amount", kind: "number" },
    { key: "plan.currency", kind: "text" },
    { key: "plan.status", kind: "text" },
    { key: "store.country", kind: "text" },
  ],
  report: [
    { key: "report.category", kind: "text" },
    { key: "report.source", kind: "text" },
  ],
  schedule: [],
};

/** What a platform workflow may do: email the platform's owners, post in its Slack, and (for an event) send it to one of its own endpoints. */
export const PLATFORM_ACTION_KINDS = ["email_staff", "post_slack", "send_request"] as const satisfies readonly WorkflowActionKind[];

export const platformFieldsFor = (trigger: PlatformWorkflowTrigger): WorkflowField[] => PLATFORM_WORKFLOW_FIELDS[platformSubjectOf(trigger)];

export const platformActionsFor = (trigger: PlatformWorkflowTrigger): WorkflowActionKind[] =>
  PLATFORM_ACTION_KINDS.filter((kind) => kind !== "send_request" || trigger !== "schedule");

export const PLATFORM_WORKFLOWS: WorkflowKit = {
  triggers: PLATFORM_WORKFLOW_TRIGGERS,
  isTrigger: isPlatformWorkflowTrigger,
  fieldsFor: (trigger) => (isPlatformWorkflowTrigger(trigger) ? platformFieldsFor(trigger) : []),
  actionsFor: (trigger) => (isPlatformWorkflowTrigger(trigger) ? platformActionsFor(trigger) : []),
};

export const platformWorkflowInputSchema = workflowSchemaFor(PLATFORM_WORKFLOWS);
