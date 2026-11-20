import { createContext } from "react";

import { keyFromHash } from "@/lib/page-modal";
import { sectionStyleLabel } from "@/lib/section-styles";
import type { ThemeTabValue } from "@/lib/theme";

import { useAdminText } from "./admin-text";

/*
 * What the page builder reads of its settings fields' module on the canvas and in its Theme tab, without the fields themselves (bloat
 * review step 2.30): the fields load with the settings panel (`lazy/builder-fields.tsx`), the contexts and helpers stay with the builder.
 */

/**
 * What the theme's Row says about every row's width (D190): a row's own choice wins, so its fields show what it comes to (its own, else
 * the theme's) and write its own only where that is not what it would be without it.
 */
export const ThemeRowWidths = createContext<{ width?: "content" | "full"; contentWidth?: "content" | "full" }>({});

/** The live theme's section styles (D242), for a row's choice; undefined where the builder has no Theme tab. */
export const ThemeSections = createContext<ThemeTabValue["sections"]>(undefined);

/** A section style's name in the account's language: the core styles' from the design words (D312 A7), a theme's own as it is written. */
export function useStyleName(): (name: string) => string {
  const names = useAdminText("designEditor").changes.styles;
  return (name) => names[name] ?? sectionStyleLabel(name);
}

/** What a button's address is, read from it: a page or web address, a popup on the page, an email or a phone number (D631). */
export type LinkKind = "address" | "popup" | "email" | "phone";

export const linkKindOf = (href: string): LinkKind | null => {
  const value = href.trim();
  if (!value) return null;
  if (keyFromHash(value)) return "popup";
  if (/^mailto:/i.test(value)) return "email";
  if (/^tel:/i.test(value)) return "phone";
  return "address";
};
