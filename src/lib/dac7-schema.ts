import { z } from "zod";

import { ibanValid } from "./dac7";

/**
 * A host's tax details as they are checked (DAC7, bloat review step 2.46), apart from the IBAN check, quarters and report helpers in
 * dac7.ts, so a screen that only shows a figure loads no zod. Import this file only where a schema runs.
 */

const country = (message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, message);

/** A host's details as they type them in their area. */
export const taxDetailsInput = z
  .object({
    kind: z.enum(["individual", "entity"]),
    legalName: z.string().trim().min(1, "Write your full name, or your business's legal name.").max(200),
    dateOfBirth: z
      .string()
      .trim()
      .transform((v) => v || null)
      .pipe(z.iso.date("Give your date of birth.").nullable()),
    address: z.string().trim().min(5, "Write your address: street, postcode and town.").max(400),
    country: country("Choose the country you live in, or where your business is."),
    tin: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, ""))
      .pipe(z.string().min(3, "Write your tax identification number.").max(40)),
    tinCountry: country("Choose the country that gave the tax identification number."),
    vatNumber: z.string().trim().max(40).default(""),
    businessNumber: z.string().trim().max(40).default(""),
    iban: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .refine((v) => v === "" || ibanValid(v), "The IBAN is not right. Check it against your bank's."),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "individual" && !value.dateOfBirth) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "Give your date of birth." });
    }
    if (value.kind === "entity" && !value.businessNumber) {
      ctx.addIssue({ code: "custom", path: ["businessNumber"], message: "Write your business's registration number." });
    }
  });
