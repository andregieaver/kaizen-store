import { SAVED_NAME_MAX } from "@/lib/saved-parts";

/** The name a page's layout starts with: the page's title, else "Untitled". */
export const defaultTemplateName = (title: string): string => title.trim().slice(0, SAVED_NAME_MAX) || "Untitled";
