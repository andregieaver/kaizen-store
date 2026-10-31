import { z } from "zod";

/**
 * Notices of illegal content on a store (DSA, Regulation (EU) 2022/2065, art. 16; D411, `docs/dsa.md`). Pure: what a notice holds and
 * how it is checked, shared by the public form and the server (`src/server/content-reports.ts`).
 *
 * Art. 16(2): a notice explains why the content is illegal (a), gives its exact address (b), names the sender with an email address (c),
 * except for the offences against children of Directive 2011/93/EU arts. 3 to 7, and states the sender's good faith (d).
 */

export const REPORT_CATEGORIES = [
  "unsafe_product",
  "counterfeit_ip",
  "illegal_goods",
  "consumer_fraud",
  "hate_violence",
  "privacy",
  "minors",
  "other",
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** The one category whose sender may stay unnamed (art. 16(2)(c)). */
export const ANONYMOUS_CATEGORY: ReportCategory = "minors";

export const EXPLANATION_MAX = 5000;
export const URL_MAX = 2000;

/** The words a refusal uses, in the form's language. */
export type ReportProblems = {
  url: string;
  category: string;
  explanation: string;
  name: string;
  email: string;
  goodFaith: string;
};

export function reportInput(problems: ReportProblems) {
  return z
    .object({
      url: z
        .string()
        .trim()
        .max(URL_MAX, problems.url)
        .refine((value) => {
          try {
            const url = new URL(value);
            return url.protocol === "https:" || url.protocol === "http:";
          } catch {
            return false;
          }
        }, problems.url),
      category: z.enum(REPORT_CATEGORIES, problems.category),
      explanation: z.string().trim().min(1, problems.explanation).max(EXPLANATION_MAX, problems.explanation),
      name: z.string().trim().max(200, problems.name),
      email: z.string().trim().max(320, problems.email),
      goodFaith: z.literal(true, problems.goodFaith),
    })
    .superRefine((input, ctx) => {
      if (input.category === ANONYMOUS_CATEGORY) {
        if (input.email !== "" && !z.email().safeParse(input.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: problems.email });
        return;
      }
      if (input.name === "") ctx.addIssue({ code: "custom", path: ["name"], message: problems.name });
      if (!z.email().safeParse(input.email).success) ctx.addIssue({ code: "custom", path: ["email"], message: problems.email });
    });
}

export type ReportInput = z.infer<ReturnType<typeof reportInput>>;

/** The store a storefront address names by its path (`/s/{slug}/…`), or null; a store on its own domain is found by host on the server. */
export function storeSlugFromUrl(value: string): string | null {
  try {
    const match = /^\/s\/([a-z0-9][a-z0-9-]*)(?:\/|$)/.exec(new URL(value).pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** The host of the address, lower case without `www.`, or null. */
export function reportHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** What the platform admin decides: something was restricted (and what), or nothing, with the reason either way. */
export const REPORT_OUTCOMES = ["actioned", "no_action"] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

/** Months a decided notice keeps its sender's name and address (`pruneContentReports()`). */
export const REPORT_SENDER_MONTHS = 12;
