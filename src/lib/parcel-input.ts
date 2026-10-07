/**
 * The parcel a carrier booking carries (D174 2.1), checked on the server: each chosen line and its units, or `null` for everything still to send. Admin actions only (zod);
 * the server checks the parcel against the order again before the carrier is paid and under the order's lock (`parcelPrecheck()`, `markSent()`).
 */
import { z } from "zod";

export const parcelLinesInput = z
  .array(z.object({ lineId: z.uuid(), quantity: z.number().int().min(0).max(999_999) }))
  .max(500)
  .nullable()
  .optional();
