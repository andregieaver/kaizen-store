/**
 * What a product still lacks before it sells well (round 1, D595, step 5): the checklist beside the product editor. Pure: it reads the
 * editor's state, never the database.
 */

export type ReadinessCheck = "photo" | "namePrice" | "stock" | "category" | "description" | "secondPhoto";

export type ReadinessInput = {
  title: string;
  description: string;
  pictures: number;
  /** Whether some active variant has a price in some market. */
  priced: boolean;
  /** Units in stock over the active physical variants; null for a product that keeps no stock (digital, bookings). */
  stock: number | null;
  categories: number;
};

/** Sentences in a description: runs of words ended by . ! or ?, the last one counted without its stop. */
export function sentences(text: string): number {
  const plain = text.replace(/<[^>]*>/g, " ").trim();
  if (!plain) return 0;
  const parts = plain.split(/[.!?]+(?:\s|$)/).filter((part) => part.trim().split(/\s+/).length >= 2);
  return parts.length;
}

export function readiness(input: ReadinessInput): { check: ReadinessCheck; done: boolean }[] {
  return [
    { check: "photo", done: input.pictures > 0 },
    { check: "namePrice", done: input.title.trim().length > 0 && input.priced },
    { check: "stock", done: input.stock === null || input.stock > 0 },
    { check: "category", done: input.categories > 0 },
    { check: "description", done: sentences(input.description) >= 2 },
    { check: "secondPhoto", done: input.pictures > 1 },
  ];
}
