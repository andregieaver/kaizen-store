import { z } from "zod";

const optional = z
  .string()
  .trim()
  .max(200)
  .transform((value) => value || null);

/** The business that sells, as the owner types it (setup and the Company page, D40). */
export const storeDetailsInput = z.object({
  name: z.string().trim().min(1, "Enter the store's name.").max(80, "Keep the store name under 80 characters."),
  legalName: z.string().trim().min(1, "Enter the business's legal name.").max(200),
  organisationNumber: optional,
  contactEmail: z.email("Enter a contact email shoppers can write to."),
  postalAddress: z.string().trim().min(5, "Enter the business address.").max(300),
  country: z.string().regex(/^[A-Z]{2}$/, "Choose the country the business is registered in."),
});
