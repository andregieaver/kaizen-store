import type { AdminUseViewerMessages } from "@/lib/admin-messages/admin-use-viewer.en";

/** A screen's key as a person reads it (`s/products/detail` is "Products › one item"): the shape only, as it was kept. */
export function screenName(key: string, w: AdminUseViewerMessages): string {
  const [level, section, sub] = key.split("/");
  if (section === undefined) return level === "s" ? w.home : w.accountHome;
  const word = (part: string) => part.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  const head = level === "a" && section === "account" ? w.accountHome : word(section);
  return sub === undefined ? head : `${head} › ${sub === "detail" ? w.detail : word(sub)}`;
}
