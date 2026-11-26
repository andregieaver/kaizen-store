/**
 * Where Guide draws in a screen (D909): an empty element the server sends, filled by Guide's runtime once it has read the person's record
 * (`guide-runtime.tsx`, by a portal), so the rail's button, the phone's link and the hints in empty pages cost a screen no script and no
 * client component of their own. `display: contents` keeps an empty slot out of its parent's layout and gaps. No state: server pages and
 * client parts both draw it.
 */
export type GuideSlotName = "rail" | "menu" | "hint";
export type GuideHintPlace = "orders" | "products" | "customers";

export function GuideSlot({ name, place }: { name: GuideSlotName; place?: GuideHintPlace }) {
  return <div data-guide-slot={name} data-place={place} style={{ display: "contents" }} />;
}
