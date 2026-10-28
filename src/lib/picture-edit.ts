/**
 * Editing a library picture with the site's AI (wave 8 unit E, D349): what is asked of the edit model, in code. Three edits: the background taken away,
 * a new background described, and a described change. The subject stays as it is in each, and the rules of every made picture hold (no words or
 * logos, anyone in it invented). Pure, so the library's dialog reads the actions and limits too.
 */

import { BRIEF_MAX, BRIEF_MIN, MADE_PICTURE_RULES } from "./picture-direction";

export const EDIT_ACTIONS = ["remove_background", "new_background", "change"] as const;
export type EditAction = (typeof EDIT_ACTIONS)[number];
export const isEditAction = (value: unknown): value is EditAction => (EDIT_ACTIONS as readonly unknown[]).includes(value);

/** Whether an edit needs a description: the new background and the change do, taking the background away does not. */
export const needsBrief = (action: EditAction): boolean => action !== "remove_background";

export { BRIEF_MAX as EDIT_BRIEF_MAX, BRIEF_MIN as EDIT_BRIEF_MIN };

const sentence = (text: string) => {
  const said = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(said) ? said : `${said}.`;
};

/** The edit model's prompt for an edit: the change asked for, what must stay, then the rules of every made picture. */
export function editPrompt(action: EditAction, brief = ""): string {
  const keep = "Keep the main subject exactly as it is: its shape, colours, details and position.";
  if (action === "remove_background") return `Remove the background entirely, leaving it transparent. ${keep} ${MADE_PICTURE_RULES}`;
  if (action === "new_background") return `Replace the background with this: ${sentence(brief)} ${keep} Match the light on the subject to the new background. ${MADE_PICTURE_RULES}`.slice(0, 4000);
  return `${sentence(brief)} Change nothing else in the picture. ${MADE_PICTURE_RULES}`.slice(0, 4000);
}

/** An edited picture's file name, from the original's: `mug-edited.webp`. */
export function editedFileName(original: string): string {
  const base = original.replace(/\.[a-z0-9]+$/i, "").replace(/-edited(?:-\d+)?$/, "").slice(0, 200) || "picture";
  return `${base}-edited.webp`;
}
