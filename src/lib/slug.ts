import { isStoreSlug } from "./paths";

const LETTERS: Record<string, string> = { æ: "ae", ø: "o", å: "a", ß: "ss", œ: "oe", þ: "th", ð: "d" };

/**
 * A store address suggested from its name: "Kari's Kopper & Kanner" becomes
 * "karis-kopper-kanner". Returns "" when nothing usable is left.
 */
export function suggestSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[æøåßœþð]/g, (c) => LETTERS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "");
  const slug = ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length >= 3 ? slug : "";
}

/** Why a store address cannot be used, or null if its format is fine. */
export function slugProblem(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return "Use 3 to 40 characters.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Use only lowercase letters, digits and hyphens.";
  if (slug.startsWith("-") || slug.endsWith("-")) return "Start and end with a letter or digit.";
  if (!isStoreSlug(slug)) return "That address is reserved.";
  return null;
}
