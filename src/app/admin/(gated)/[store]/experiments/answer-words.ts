import "server-only";

import { adminText } from "@/lib/admin-text";
import { experimentAnswer } from "@/lib/experiment-words";
import { actionAdminLang } from "@/server/admin-request-lang";

/**
 * An A/B test action's answer in the account's language (D312 A7, bloat review step 2.26): the server writes its refusals in English, as
 * the AI manager and the tests read them, and the screens draw what the action hands them.
 */
export async function inAccountWords<T>(answer: T): Promise<T> {
  return experimentAnswer(answer, adminText(await actionAdminLang(), "experiments"));
}
