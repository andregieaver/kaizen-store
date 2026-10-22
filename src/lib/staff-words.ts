/**
 * Role names in the account's language (D312 A8): a store's starting roles are made with their English names (`ROLE_TEMPLATES`), so a
 * role still named as its template was is shown in the catalogue's words; a name an owner typed is shown as typed. Pure, for the server's
 * pages and the browser's parts alike.
 */
import type { StaffMessages } from "./admin-messages/staff.en";
import { ROLE_TEMPLATE_KEYS, ROLE_TEMPLATES } from "./permissions";

/** A role's name as the admin shows it: the template's own name in the account's words, else the name as stored. */
export function roleNameIn(name: string, words?: Pick<StaffMessages, "templates">): string {
  if (!words) return name;
  const key = ROLE_TEMPLATE_KEYS.find((k) => ROLE_TEMPLATES[k].name === name);
  return key ? words.templates[key].name : name;
}

/** A starting role's description in the account's words. */
export function roleDescriptionIn(template: keyof typeof ROLE_TEMPLATES, words?: Pick<StaffMessages, "templates">): string {
  return words ? words.templates[template].description : ROLE_TEMPLATES[template].description;
}
