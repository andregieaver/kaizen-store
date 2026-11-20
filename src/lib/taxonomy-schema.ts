import { z } from "zod";

import { isPictureAddress } from "./picture-address";
import { slugify } from "./slug";
import { termSeoShape } from "./term-seo-schema";
import { ITEM_TERMS_MAX, TERM_KINDS, TERM_NAME_MAX, TERM_SLUG_MAX, termSlugProblem } from "./taxonomy";

/**
 * Categories and tags as they are checked (D50, bloat review step 2.46): termInput and termIdsSchema, apart from the kinds, limits
 * and tree helpers in taxonomy.ts, so a screen that only lists or picks a term loads no zod. Import this file only where a schema runs.
 */

/** A category or tag as the admin sends it; an empty address is made from the name. */
export const termInput = z
  .object({
    kind: z.enum(TERM_KINDS),
    name: z
      .string()
      .trim()
      .min(1, "Give it a name.")
      .max(TERM_NAME_MAX, `Keep the name under ${TERM_NAME_MAX} characters.`),
    slug: z.string().trim().default(""),
    parentId: z.uuid().nullable().default(null),
    /** Unit price (D160): left out means unchanged on an update and off on a new one; true only for a product category. */
    requiresUnitPrice: z.boolean().optional(),
    /**
     * Search title and description per language (D168): left out means unchanged on an update and none on a new one; a language with both empty is removed.
     * The shape is held here; the server checks the languages against the store's own (`termSeoInput(locales)`).
     */
    seo: termSeoShape.optional(),
    /**
     * The term's own page (D319), for a store's product categories and tags: left out means unchanged on an update and none on a new one. The
     * shapes are checked on the server (`cleanTermDescription()`, `termTextsInput()` with the store's languages, the picture as a library file).
     */
    description: z.unknown().optional(),
    image: z
      .object({
        url: z.string().trim().max(1000).refine(isPictureAddress, "The picture has an invalid address."),
        thumbnailUrl: z.string().trim().max(1000).refine(isPictureAddress, "The picture has an invalid address.").nullable().default(null),
      })
      .nullable()
      .optional(),
    texts: z.record(z.string(), z.unknown()).optional(),
    /**
     * Filled by rules (D319): left out means unchanged; null fills it by hand again; the conditions are checked on the server against the store
     * (`checkedRules()`). Turning rules on takes out the products placed by hand; turning them off keeps the products that matched as placed
     * products when `keepMatches` is set.
     */
    rules: z.unknown().optional(),
    keepMatches: z.boolean().optional(),
  })
  .transform((term, ctx) => {
    const slug = term.slug || slugify(term.name, TERM_SLUG_MAX);
    const problem = termSlugProblem(slug);
    if (problem) {
      ctx.addIssue({ code: "custom", message: term.slug ? problem : "Use letters or digits in the name." });
      return z.NEVER;
    }
    return { ...term, slug, parentId: term.kind === "tag" ? null : term.parentId };
  });

/** The ids an item is in, as stored with it: unique, and at most `ITEM_TERMS_MAX` of each. */
export const termIdsSchema = z.object({
  categories: z.array(z.uuid()).max(ITEM_TERMS_MAX, `Choose at most ${ITEM_TERMS_MAX} categories.`).default([]),
  tags: z.array(z.uuid()).max(ITEM_TERMS_MAX, `Choose at most ${ITEM_TERMS_MAX} tags.`).default([]),
});
