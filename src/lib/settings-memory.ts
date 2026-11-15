/**
 * What the page builder's settings panel keeps while the owner moves from one part's settings to another's (D631): the tab last
 * chosen, how far each kind of part's tab was scrolled, and which folds are open. A button's Design opened after another button's
 * opens on Design, scrolled where the other was, with the same folds open; a row opened after a button opens on the tab the button
 * was left on. It lives as long as the builder is open.
 */

/** A settings panel's four tabs: what it says (a row's or column's layout), how it looks, how it moves, who sees it. */
export const SETTINGS_TABS = ["content", "design", "motion", "visibility"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type SettingsMemory = {
  tab: SettingsTab;
  /** By `scrollKey()`: pixels from the top of the panel's body. */
  scroll: Record<string, number>;
  /** By fold: open or closed, as the owner left it; a fold not named keeps its own default. */
  open: Record<string, boolean>;
};

export const newSettingsMemory = (): SettingsMemory => ({ tab: "content", scroll: {}, open: {} });

/** Where a kind of part's tab was scrolled is kept under this. */
export const scrollKey = (kind: string, tab: SettingsTab): string => `${kind}|${tab}`;

/** How far to scroll a kind of part's tab when it opens: where it was left, else the top. */
export const rememberedScroll = (memory: SettingsMemory, kind: string, tab: SettingsTab): number => memory.scroll[scrollKey(kind, tab)] ?? 0;

/** Keeps where a kind of part's tab is scrolled. */
export function keepScroll(memory: SettingsMemory, kind: string, tab: SettingsTab, top: number): void {
  memory.scroll[scrollKey(kind, tab)] = Math.max(0, Math.round(top));
}

/** Whether a fold is open: as it was left, else its default. */
export const foldOpen = (memory: SettingsMemory, fold: string, byDefault: boolean): boolean => memory.open[fold] ?? byDefault;

/** Keeps the tab last chosen. */
export function keepTab(memory: SettingsMemory, tab: SettingsTab): void {
  memory.tab = tab;
}

/** Keeps a fold open or closed as the owner left it. */
export function keepFold(memory: SettingsMemory, fold: string, open: boolean): void {
  memory.open[fold] = open;
}
