import { z } from "zod";

/** The schemas of colours (D180, `colour.ts`), kept beside its plain helpers so a visitor's script reads those without zod (bloat review step 2.10). */

/** An opacity as stored: 0 (invisible) to 100 (solid). */
export const opacityValue = z
  .number()
  .int("An opacity is a whole number from 0 to 100.")
  .min(0, "An opacity is 0 to 100.")
  .max(100, "An opacity is 0 to 100.");
