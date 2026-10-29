/**
 * The AI manager's message box, found by what it is rather than by its words (wave 11 unit K, D390, PSI ACC-08): the launcher's ⌘K and
 * an alert's *Ask the AI manager* on the assistant's own page focused it by its English placeholder, which a Norwegian account never
 * saw. The panel's box is kept by ref; the page's (another component's) carries `data-ai-composer`.
 */
export const AI_COMPOSER_ATTRIBUTE = "data-ai-composer";

/** Focuses the AI manager's message box on the page, if there is one; says whether there was. */
export function focusAiComposer(): boolean {
  const box = document.querySelector<HTMLTextAreaElement>(`textarea[${AI_COMPOSER_ATTRIBUTE}]`);
  box?.focus();
  return Boolean(box);
}
