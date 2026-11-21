import { z } from "zod";

import {
  ACTIONS_MAX,
  CONDITIONS_MAX,
  OPERATORS,
  type Operator,
  STORE_WORKFLOWS,
  VALUE_MAX,
  type WorkflowAction,
  type WorkflowKit,
} from "./workflows";

/**
 * The schemas of workflows.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; workflows.ts imports it as a type alone.
 */

const tag = z.string().trim().min(1).max(40);
const text = (max: number) => z.string().trim().min(1).max(max);

/** Every action but the hold, which only `order.paid` takes (`actionsFor()`). */
const DRAFT_ACTIONS = [
  z.object({ kind: z.literal("tag_order"), tag }),
  z.object({ kind: z.literal("note_order"), text: text(1000) }),
  z.object({ kind: z.literal("tag_customer"), tag }),
  z.object({ kind: z.literal("email_staff"), subject: text(120), text: text(2000) }),
  z.object({ kind: z.literal("post_slack"), text: text(2000) }),
  z.object({ kind: z.literal("send_request"), endpointId: z.uuid() }),
  z.object({ kind: z.literal("ask_ai_manager"), question: text(400) }),
] as const;

export const workflowActionSchema = z.discriminatedUnion("kind", [...DRAFT_ACTIONS, z.object({ kind: z.literal("hold_order"), reason: text(200) })]);

type SchemaParts = { actions: z.ZodType<WorkflowAction>; operators: readonly [Operator, ...Operator[]]; valueMax: number };

/** A workflow's shape, its trigger one of a kit's. */
export const workflowSchemaFor = (
  kit: Pick<WorkflowKit, "isTrigger">,
  parts: SchemaParts = { actions: workflowActionSchema, operators: OPERATORS, valueMax: VALUE_MAX },
) => z.object({
  name: z.string().trim().min(1).max(80),
  trigger: z.string().refine(kit.isTrigger, "Choose what starts the workflow."),
  schedule: z
    .object({
      every: z.enum(["day", "week"]),
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "A time is HH:MM."),
      weekday: z.int().min(1).max(7).nullable().default(null),
    })
    .nullable()
    .default(null),
  conditions: z.array(z.object({ field: z.string(), op: z.enum(parts.operators), value: z.string().trim().max(parts.valueMax) })).max(CONDITIONS_MAX).default([]),
  actions: z.array(parts.actions).min(1, "Add at least one action.").max(ACTIONS_MAX),
});

export const workflowInputSchema = workflowSchemaFor(STORE_WORKFLOWS);
