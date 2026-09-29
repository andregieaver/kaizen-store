import type { FieldImage, FieldVideo, ShownBlock, ShownField, ShownGroup, ShownLink } from "./custom-fields";
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

/** An address a link may point at: a web address, or a path on the site (one slash, never `//` or `/\\`). */
export const isSafeAddress = (value: string): boolean => {
  const address = value.trim();
  // A web address, a path on the site, or an anchor on the page (`#kontakt`, or `#` alone).
  return isWebAddress(address) || (/^\/(?![/\\])/.test(address) && !/\s/.test(address)) || /^#\S*$/.test(address);
};

/** Whether a link goes to a page of the site itself (a path), so it can use the router. */
export const isInternalAddress = (value: string): boolean => value.trim().startsWith("/");

/** The links of a file, link or relational field that are safe to draw, with their address trimmed and a picture kept only if it is one. */
export const linksOf = (field: ShownField): ShownLink[] =>
  (field.links ?? []).flatMap((link) => {
    const href = link.href.trim();
    if (!isSafeAddress(href)) return [];
    const image = link.image && isPictureAddress(link.image) ? link.image : null;
    // A link without words is still worth following: it is drawn as its address.
    return [{ ...link, href, label: link.label.trim() || href, image }];
  });

/** A file's kind for a reader ("PDF", "DOCX"), from its type, else the ending of its name; null when neither says. */
export function fileKind(contentType: string | undefined, name: string): string | null {
  const known: Record<string, string> = {
    "application/pdf": "PDF",
    "application/zip": "ZIP",
    "text/csv": "CSV",
    "text/plain": "TXT",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "application/vnd.ms-excel": "XLS",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
    "application/vnd.ms-powerpoint": "PPT",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  };
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (known[type]) return known[type];
  const ending = /\.([a-z0-9]{1,5})$/i.exec(name.trim())?.[1];
  return ending ? ending.toUpperCase() : null;
}

/** A group's children that can be drawn. */
export const drawableChildren = (field: ShownField): ShownField[] => (field.children ?? []).filter(drawable);

/** A repeater's rows with only what can be drawn; a row with nothing left is dropped. */
export const drawableRows = (field: ShownField): ShownField[][] =>
  (field.rows ?? []).map((row) => row.filter(drawable)).filter((row) => row.length > 0);

/** Flexible content's rows with only what can be drawn; a row with nothing left is dropped, and each keeps its layout. */
export const drawableBlocks = (field: ShownField): ShownBlock[] =>
  (field.blocks ?? []).map((block) => ({ ...block, fields: block.fields.filter(drawable) })).filter((block) => block.fields.length > 0);

/**
 * Whether a value says what it is without its label, as content in a flexible
 * row (a paragraph, a picture, a video, a link) does; a number, a date or an
 * amount does not, and keeps its label there.
 */
export const standsAlone = (field: ShownField): boolean =>
  ["text", "textarea", "richText", "image", "gallery", "video", "link", "file", "product", "page", "term", "group"].includes(field.type);

/** A repeater's table columns: each field (by id) in order of first appearance, so a row that lacks one gets an empty cell. */
export function repeaterColumns(rows: ShownField[][]): { id: string; label: string }[] {
  const columns = new Map<string, string>();
  for (const row of rows) for (const cell of row) if (!columns.has(cell.id)) columns.set(cell.id, cell.label);
  return [...columns].map(([id, label]) => ({ id, label }));
}

/** Whether a field has anything fit to draw; one that has not is left out with its label. */
export function drawable(field: ShownField): boolean {
  switch (field.type) {
    case "file":
    case "link":
    case "product":
    case "page":
    case "term":
      return linksOf(field).length > 0;
    case "group":
      return drawableChildren(field).length > 0;
    case "repeater":
      return drawableRows(field).length > 0;
    case "flexible":
      return drawableBlocks(field).length > 0;
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
