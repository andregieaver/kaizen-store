import { z } from "zod";

import { BREAKPOINT_MAX, BREAKPOINT_MIN, breakpointsProblem } from "./breakpoints";

/**
 * The schemas of `breakpoints.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

const width = z.number().int().min(BREAKPOINT_MIN).max(BREAKPOINT_MAX);

export const breakpointsSchema = z
  .object({ md: width, lg: width, xl: width })
  .superRefine((value, ctx) => {
    const problem = breakpointsProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
