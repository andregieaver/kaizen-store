import type { FieldImage, FieldVideo, ShownField, ShownGroup } from "./custom-fields";
import { isPictureAddress } from "./picture-address";
import { embedUrl } from "./video-embed";

/**
 * What a template draws of a store's custom fields (D118): which groups and
 * fields a component shows, and whether a value is fit to draw. Pure, so
 * the site's renderer (`custom-fields-view.tsx`) and the checks of whether a
 * part has anything to show (`productPartShows()`, a page component) agree,
 * and a stored value is never trusted to be safe to put in a link, a style
 * or a picture's address just because the editor checked it once.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/** A web address worth linking: http or https only. */
export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** The address for a `mailto:` link, or null when the text is not an email address. */
export const mailAddress = (text: string): string | null => (EMAIL.test(text.trim()) ? text.trim() : null);

/** The number for a `tel:` link (digits and a leading plus), or null when the text has too few digits. */
export function phoneNumber(text: string): string | null {
  const number = text.replace(/[^\d+]/g, "");
  return number.replace(/\D/g, "").length >= 3 ? number : null;
}

export function pictureOf(value: unknown): FieldImage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { url, thumbnailUrl, alt } = value as Record<string, unknown>;
  if (typeof url !== "string" || !isPictureAddress(url)) return null;
  return {
    url,
    thumbnailUrl: typeof thumbnailUrl === "string" && isPictureAddress(thumbnailUrl) ? thumbnailUrl : null,
    alt: typeof alt === "string" ? alt : "",
  };
}

export const picturesOf = (value: unknown): FieldImage[] =>
  Array.isArray(value) ? value.flatMap((item) => pictureOf(item) ?? []) : [];

/** A video field's player address, or null when its address is not a video on YouTube or Vimeo. */
export function videoOf(value: unknown): { video: FieldVideo; player: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { source, link } = value as Record<string, unknown>;
  if ((source !== "youtube" && source !== "vimeo") || typeof link !== "string") return null;
  const player = embedUrl(source, link);
  return player ? { video: { source, link }, player } : null;
}

/** Whether a field has anything fit to draw; one that has not is left out with its label. */
export function drawable(field: ShownField): boolean {
  switch (field.type) {
    case "checkbox":
      return (field.items ?? []).some((item) => item.trim() !== "");
    case "richText":
      return (
        typeof field.value === "object" &&
        !Array.isArray(field.value) &&
        "type" in field.value &&
        field.value.type === "doc"
      );
    case "image":
      return pictureOf(field.value) !== null;
    case "gallery":
      return picturesOf(field.value).length > 0;
    case "video":
      return videoOf(field.value) !== null;
    default:
      return field.text.trim() !== "";
  }
}

/** A group's fields that can be drawn; none left: the group is left out. */
export const drawableGroup = (group: ShownGroup): ShownGroup | null => {
  const fields = group.fields.filter(drawable);
  return fields.length > 0 ? { ...group, fields } : null;
};

/** The groups a component shows: the one chosen (`groupId`), else all of them, without what cannot be drawn. */
export const groupsToShow = (groups: ShownGroup[], groupId?: string): ShownGroup[] =>
  groups.flatMap((group) => (groupId && group.id !== groupId ? [] : (drawableGroup(group) ?? [])));

/** The field a component names, if the thing has a value for it that can be drawn. */
export function fieldToShow(groups: ShownGroup[], fieldId?: string): ShownField | null {
  if (!fieldId) return null;
  for (const group of groups) {
    const field = group.fields.find((f) => f.id === fieldId);
    if (field) return drawable(field) ? field : null;
  }
  return null;
}

/** What a component's heading settings give over a group: its own words for the one group chosen, else the group's name; none when switched off. */
export function groupHeading(
  block: { showHeading?: boolean; heading?: string },
  group: ShownGroup,
  chosen: boolean,
): string | null {
  if (block.showHeading === false) return null;
  return (chosen && block.heading?.trim()) || group.name;
}

/** A single field's heading: only the words the owner wrote, as a field has no name for a heading of its own. */
export function fieldHeading(block: { showHeading?: boolean; heading?: string }): string | null {
  return block.showHeading === false ? null : block.heading?.trim() || null;
}

/** The settings of a component that shows custom fields, in a product layout or on a page. */
export type FieldsSelection = { groupId?: string; fieldId?: string };

/** Whether a page component with these settings has something to show among the groups. */
export function customFieldsShow(selection: FieldsSelection, groups: ShownGroup[]): boolean {
  return selection.fieldId
    ? fieldToShow(groups, selection.fieldId) !== null
    : groupsToShow(groups, selection.groupId).length > 0;
}
