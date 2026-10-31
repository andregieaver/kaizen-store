/**
 * The admin's keyboard shortcuts in one list (PSI UX-07): what `?` shows. The keys are the ones the admin already binds (the AI manager's
 * launcher, the page builder, the message boxes); a new shortcut is added here so the list stays true. Pure.
 */

export type ShortcutGroup = "everywhere" | "builder" | "writing";
export type ShortcutAction = "assistant" | "sheet" | "save" | "undo" | "redo" | "find" | "sizes" | "send";

/** `mod` is Cmd on a Mac and Ctrl elsewhere. */
export const SHORTCUTS: readonly { group: ShortcutGroup; action: ShortcutAction; keys: readonly string[] }[] = [
  { group: "everywhere", action: "assistant", keys: ["mod", "K"] },
  { group: "everywhere", action: "sheet", keys: ["?"] },
  { group: "builder", action: "save", keys: ["mod", "S"] },
  { group: "builder", action: "undo", keys: ["mod", "Z"] },
  { group: "builder", action: "redo", keys: ["mod", "Shift", "Z"] },
  { group: "builder", action: "find", keys: ["mod", "Shift", "H"] },
  { group: "builder", action: "sizes", keys: ["mod", "Shift", "R"] },
  { group: "writing", action: "send", keys: ["mod", "Enter"] },
];

/** A key as it is shown: Cmd's and Shift's signs on a Mac, their names elsewhere. */
export const keyLabel = (key: string, mac: boolean): string =>
  key === "mod" ? (mac ? "⌘" : "Ctrl") : key === "Shift" ? (mac ? "⇧" : "Shift") : key === "Enter" ? (mac ? "↩" : "Enter") : key;

/** Whether a key press asks for the list: `?` with no Ctrl, Cmd or Alt, outside anything that takes typing. */
export function opensShortcutSheet(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, typing: boolean): boolean {
  return event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing;
}
