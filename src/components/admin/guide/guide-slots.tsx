/**
 * Where Guide draws in a screen (D909): an empty element the server sends, filled by Guide's runtime once it has read the person's record
 * (`guide-runtime.tsx`, by a portal), so a hint in an empty page costs it no script and no client component of its own. The rail's button
 * and the phone menu's link need no slot: the runtime adds their items to the rail's foot and beside the menu's Your account, so the frame
 * carries nothing of Guide but its provider. `display: contents` keeps an empty slot out of its parent's layout and gaps.
 */
export type GuideSlotName = "hint";
export type GuideHintPlace = "orders" | "products" | "customers";

export function GuideSlot({ name, place }: { name: GuideSlotName; place?: GuideHintPlace }) {
  return <div data-guide-slot={name} {...(place && { "data-place": place })} style={{ display: "contents" }} />;
}
