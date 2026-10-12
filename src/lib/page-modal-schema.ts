import { z } from "zod";

import { MODAL_DAYS_MAX, MODAL_DAYS_MIN, MODAL_FREQUENCIES, MODAL_NAME_MAX, MODAL_OVERLAY_KEYS, MODAL_POSITIONS, MODAL_SECONDS_MAX, MODAL_SECONDS_MIN, MODAL_SIZE_KEYS, type ModalFrequency, type ModalPosition, NO_WAY_TO_CLOSE, NO_WAY_TO_OPEN, classProblem, hasTrigger, keyProblem } from "./page-modal";

/**
 * The schemas of `page-modal.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

/** Empty text is the same as none. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema.optional());

/** What the editor sends and the site reads (`pageRowSchema`), with the checks shown to the admin. */
export const rowModalSchema = z
  .object({
    key: z
      .string()
      .trim()
      .superRefine((key, ctx) => {
        const problem = keyProblem(key);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
    name: optional(
      z.string().trim().max(MODAL_NAME_MAX, `Keep the modal's name to ${MODAL_NAME_MAX} characters or fewer.`),
    ),
    triggers: z.object({
      button: z.boolean().optional(),
      className: optional(
        z
          .string()
          .trim()
          .superRefine((name, ctx) => {
            const problem = classProblem(name);
            if (problem) ctx.addIssue({ code: "custom", message: problem });
          }),
      ),
      exitIntent: z.boolean().optional(),
      timer: z
        .object({
          seconds: z
            .number()
            .int("The timer is whole seconds.")
            .min(MODAL_SECONDS_MIN, `The timer is at least ${MODAL_SECONDS_MIN} second.`)
            .max(MODAL_SECONDS_MAX, `The timer is at most ${MODAL_SECONDS_MAX} seconds.`),
        })
        .optional(),
    }),
    frequency: z.enum(Object.keys(MODAL_FREQUENCIES) as [ModalFrequency, ...ModalFrequency[]]),
    days: z
      .number()
      .int("Days are whole days.")
      .min(MODAL_DAYS_MIN, `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.`)
      .max(MODAL_DAYS_MAX, `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.`)
      .optional(),
    size: z.enum(MODAL_SIZE_KEYS),
    position: z.enum(Object.keys(MODAL_POSITIONS) as [ModalPosition, ...ModalPosition[]]).optional(),
    overlay: z.enum(MODAL_OVERLAY_KEYS).optional(),
    closeOnOverlay: z.boolean().optional(),
    closeButton: z.boolean().optional(),
  })
  .superRefine((modal, ctx) => {
    if (!hasTrigger(modal.triggers)) ctx.addIssue({ code: "custom", message: NO_WAY_TO_OPEN });
    if (modal.frequency === "days" && modal.days === undefined) {
      ctx.addIssue({ code: "custom", message: `Choose between ${MODAL_DAYS_MIN} and ${MODAL_DAYS_MAX} days.` });
    }
    if (modal.closeButton === false && modal.closeOnOverlay === false)
      ctx.addIssue({ code: "custom", message: NO_WAY_TO_CLOSE });
  });
