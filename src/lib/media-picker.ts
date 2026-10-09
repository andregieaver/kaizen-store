/**
 * What an editor's picture picker takes from the media library (D88): a compact view of a picture, never the library's uses
 * or alt translations. `list` is bound to the owner on the server (a store, or Kaizen).
 */
export type PickerPicture = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  fileName: string;
  width: number | null;
  height: number | null;
  /** Its alt text in the owner's main language, which a picture placed on a page starts with. */
  alt: string;
};

export type PickerList = (query: { q: string; limit: number }) => Promise<{ items: PickerPicture[]; total: number }>;

/** The most pictures the picker shows at once ("Show more" adds a page). */
export const PICKER_PAGE = 48;
export const PICKER_MOST = 240;

/** A picture's size, read from the browser when the library has not measured it yet. */
export const FALLBACK_SIZE = { width: 1600, height: 900 } as const;
