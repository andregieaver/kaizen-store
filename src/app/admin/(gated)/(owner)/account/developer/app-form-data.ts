import { isApiPower } from "@/lib/admin-api";
import { APP_DISTRIBUTIONS, APP_SCOPES, APP_TOPICS } from "@/lib/apps";
import { type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { EVENTS } from "@/lib/integrations";
import { STORES_READ } from "@/lib/oauth";
import { scopeLabel } from "@/lib/oauth-words";

/** The app form's choices in the account's language (D441): the scopes, the powers, the topics and the three distributions. */
export function appFormChoices(lang: AdminLang) {
  const w = adminText(lang, "oauth");
  const powerWords = adminText(lang, "notifications").apiTokens.scopeWords;
  const labelOf = new Map(EVENTS.map((e) => [e.id, e.label]));
  return {
    scopes: APP_SCOPES.filter((s) => s !== STORES_READ && !isApiPower(s)).map((s) => ({ value: s, label: scopeLabel(w, s) })),
    powers: APP_SCOPES.filter((s) => isApiPower(s)).map((s) => ({ value: s, label: powerWords[s] ?? s })),
    topics: APP_TOPICS.map((t) => ({ value: t, label: labelOf.get(t) ?? t })),
    distributions: APP_DISTRIBUTIONS.map((d) => ({ value: d, label: w.developer.distributions[d] })),
  };
}
