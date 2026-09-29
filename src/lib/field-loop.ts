import {
  subFieldsOf,
  type FieldDef,
  type FieldImage,
  type ShownField,
  type ShownGroup,
  type ShownLink,
} from "./custom-fields";
import { drawable, drawableRows, fieldToShow, linksOf, pictureOf } from "./field-parts";
import type { LoopConfig, LoopSlot, LoopSlots, ProductBlock, RichTextDoc } from "./page-content";

/**
 * The field loop (D120): a repeater's rows drawn as cards, a list or columns,
 * each row laid out from slots the owner filled with its sub fields (a
 * picture, a title, a text, a link and a badge). Pure, so the builder's
 * pickers, the checks of whether a loop has anything to show and the site's
 * renderer (`field-loop-view.tsx`) agree on which sub field fits which slot
 * and on what a row gives. Values arrive as `ShownField`s (public, in the
 * shopper's language, empty rows already left out) and are checked again as
 * they are drawn: a picture only if it is one of ours, a link only if its
 * address is safe.
 */

const TEXT_LIKE: readonly string[] = [
  "text",
  "number",
  "measurement",
  "money",
  "select",
  "radio",
  "buttons",
  "date",
  "datetime",
  "time",
  "email",
  "phone",
];

/** The field types each slot takes. */
export const SLOT_TYPES: Record<LoopSlot, readonly string[]> = {
  image: ["image"],
  title: TEXT_LIKE,
  text: ["text", "textarea", "richText"],
  link: ["link", "file"],
  badge: TEXT_LIKE,
};

/** The slots in the order they are offered. */
export const LOOP_SLOT_KEYS: readonly LoopSlot[] = ["image", "title", "text", "link", "badge"];

/** Whether a field of this type can fill the slot. */
export const fitsSlot = (slot: LoopSlot, type: string): boolean => SLOT_TYPES[slot].includes(type);

/** A field the loop can draw the rows of: a repeater. */
export const isLoopable = (def: Pick<FieldDef, "type">): boolean => def.type === "repeater";

/** The sub fields of a repeater that can fill a slot. */
export const slotChoices = (repeater: Pick<FieldDef, "type" | "subFields">, slot: LoopSlot): FieldDef[] =>
  subFieldsOf(repeater).filter((sub) => fitsSlot(slot, sub.type));

/**
 * A first choice of slots for a repeater, so a new loop shows something at
 * once: a picture, a title (a short text, else any that fits), a text (long
 * text, else another short one), a link and a badge (a choice), each sub field used once.
 */
export function suggestSlots(repeater: Pick<FieldDef, "type" | "subFields">): LoopSlots {
  const slots: LoopSlots = {};
  const used = new Set<string>();
  const take = (slot: LoopSlot, prefer: readonly string[]) => {
    const choices = slotChoices(repeater, slot).filter((sub) => !used.has(sub.id));
    const pick = prefer.map((type) => choices.find((sub) => sub.type === type)).find(Boolean) ?? choices[0];
    if (!pick) return;
    slots[slot] = pick.id;
    used.add(pick.id);
  };
  take("image", []);
  take("title", ["text"]);
  take("text", ["textarea", "richText", "text"]);
  take("link", ["link", "file"]);
  take("badge", ["select", "radio", "buttons"]);
  return slots;
}

/** The slots that name a sub field the repeater no longer has, or of a kind that no longer fits, taken out. */
export function validSlots(repeater: Pick<FieldDef, "type" | "subFields">, slots: LoopSlots | undefined): LoopSlots {
  const out: LoopSlots = {};
  for (const slot of LOOP_SLOT_KEYS) {
    const id = slots?.[slot];
    if (id && slotChoices(repeater, slot).some((sub) => sub.id === id)) out[slot] = id;
  }
  return out;
}

/** A row's words for the text slot: plain lines, or rich text drawn as elements. */
export type LoopText = { kind: "plain"; text: string } | { kind: "rich"; doc: RichTextDoc };

/** What one row of the loop gives each slot; a slot with nothing to draw is left out. */
export type LoopRow = {
  image?: FieldImage;
  title?: string;
  text?: LoopText;
  badge?: string;
  link?: ShownLink;
};

/** The repeater a loop shows, if the thing has rows for it that can be drawn. */
export function loopField(groups: ShownGroup[], fieldId: string | undefined): ShownField | null {
  const field = fieldToShow(groups, fieldId);
  return field && field.type === "repeater" ? field : null;
}

/** The rows of a repeater as its slots draw them; a row that gives nothing is dropped. */
export function loopRows(field: ShownField | null, slots: LoopSlots | undefined): LoopRow[] {
  if (!field || field.type !== "repeater" || !slots) return [];
  return drawableRows(field).flatMap((cells): LoopRow[] => {
    const cell = (slot: LoopSlot): ShownField | undefined => {
      const id = slots[slot];
      const found = id ? cells.find((c) => c.id === id) : undefined;
      return found && fitsSlot(slot, found.type) && drawable(found) ? found : undefined;
    };
    const row: LoopRow = {};
    const image = cell("image");
    const picture = image ? pictureOf(image.value) : null;
    if (picture) row.image = picture;
    const title = cell("title")?.text.trim();
    if (title) row.title = title;
    const text = cell("text");
    if (text) {
      if (text.type === "richText") row.text = { kind: "rich", doc: text.value as RichTextDoc };
      else if (text.text.trim() !== "") row.text = { kind: "plain", text: text.text.trim() };
    }
    const badge = cell("badge")?.text.trim();
    if (badge) row.badge = badge;
    const link = cell("link");
    const target = link ? linksOf(link)[0] : undefined;
    if (target) row.link = target;
    return Object.keys(row).length > 0 ? [row] : [];
  });
}

/** The rows a loop configured like this draws from a thing's public fields. */
export const loopOf = (groups: ShownGroup[], config: Pick<LoopConfig, "fieldId" | "slots">): LoopRow[] =>
  loopRows(loopField(groups, config.fieldId), config.slots);

/** Whether a loop has anything to draw (a loop with nothing to show leaves no space behind). */
export const loopShows = (groups: ShownGroup[], config: Pick<LoopConfig, "fieldId" | "slots">): boolean =>
  loopOf(groups, config).length > 0;

/** The words over a loop: only what the owner wrote, none when switched off. */
export const loopHeading = (config: Pick<LoopConfig, "showHeading" | "heading">): string | null =>
  config.showHeading === false ? null : config.heading?.trim() || null;

/** A product layout's loop part, as the same settings a page's loop block has. */
export const productLoopConfig = (
  block: Pick<ProductBlock, "fieldId" | "groupId" | "showHeading" | "heading" | "loop">,
): LoopConfig => ({
  fieldId: block.fieldId,
  groupId: block.groupId,
  showHeading: block.showHeading,
  heading: block.heading,
  ...block.loop,
});

/**
 * What a change to a loop's settings does to a product layout's part: the
 * layout, columns, slots and link go into its `loop`, the repeater and the
 * heading are the part's own settings.
 */
export function productLoopPatch(block: Pick<ProductBlock, "loop">, patch: Partial<LoopConfig>): Partial<ProductBlock> {
  const { layout, columns, slots, linkWholeCard, ...own } = patch;
  const given = { layout, columns, slots, linkWholeCard };
  const keys = (Object.keys(given) as (keyof typeof given)[]).filter((key) => key in patch);
  if (keys.length === 0) return own;
  const loop: Record<string, unknown> = { ...block.loop };
  for (const key of keys) {
    if (given[key] === undefined) delete loop[key];
    else loop[key] = given[key];
  }
  return { ...own, loop: Object.keys(loop).length > 0 ? (loop as ProductBlock["loop"]) : undefined };
}
