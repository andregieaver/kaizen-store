/**
 * A row of chips or cards on a phone (round 17, D652): one line that scrolls sideways, reaching the screen's edges, instead of wrapping onto
 * four lines; from 640 px up it wraps as before. Each item adds `CHIP_ITEM` so it keeps its width.
 */
export const CHIP_STRIP = "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0";
export const CHIP_ITEM = "shrink-0 whitespace-nowrap";

/** The list with the chosen one first, so a phone's strip shows it without scrolling. */
export function chosenFirst<T>(items: readonly T[], isChosen: (item: T) => boolean): T[] {
  return [...items.filter(isChosen), ...items.filter((item) => !isChosen(item))];
}
