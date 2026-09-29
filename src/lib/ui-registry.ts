/**
 * The interface text of languages that have no hand-written text (D111), as
 * `Messages` built from the catalogue, by language. One registry per
 * JavaScript realm, kept on `globalThis` so the server's separately bundled
 * modules and the browser's provider all see the same one: the server fills it
 * from the database (`src/server/ui-text.ts`), the browser from what the
 * storefront's layout sends (`UiProvider`). `t()` and `emailText()` read it, so
 * a language that is not there is English, as before.
 */

type Entry = { ui?: unknown; email?: unknown };

const KEY = "__kaizenUiRegistry";

function registry(): Map<string, Entry> {
  const scope = globalThis as unknown as Record<string, Map<string, Entry> | undefined>;
  return (scope[KEY] ??= new Map());
}

export const registeredUi = (lang: string): unknown => registry().get(lang)?.ui;
export const registeredEmail = (lang: string): unknown => registry().get(lang)?.email;

/** Sets a language's messages (either or both namespaces); the language's other namespace is kept. */
export function registerMessages(lang: string, entry: Entry): void {
  registry().set(lang, { ...registry().get(lang), ...entry });
}

export const forgetMessages = (lang: string) => void registry().delete(lang);

export const registeredLanguages = (): string[] => [...registry().keys()];
