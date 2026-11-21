import { workflowSchemaFor } from "./workflows-schema";
import { PLATFORM_WORKFLOWS } from "./platform-workflows";

/**
 * The schemas of platform-workflows.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; platform-workflows.ts imports it as a type alone.
 */

export const platformWorkflowInputSchema = workflowSchemaFor(PLATFORM_WORKFLOWS);
