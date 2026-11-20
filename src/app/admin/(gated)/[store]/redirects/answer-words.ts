import "server-only";

import { redirectAnswer } from "@/lib/redirect-words";
import { REDIRECTS_WORDS } from "@/lib/admin-words/redirects";
import { actionAdminLang } from "@/server/admin-request-lang";

/**
 * A redirect action's answer in the account's language (D312 A7, bloat review step 2.26): the service writes English, as the import's
 * stored findings, the AI manager and the tests read it, and the screens draw what the action hands them.
 */
export async function inAccountWords<T>(answer: T): Promise<T> {
  return redirectAnswer(answer, REDIRECTS_WORDS[await actionAdminLang()]);
}
