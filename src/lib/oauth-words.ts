import { fillWords } from "@/lib/admin-fill";
import type { OauthMessages } from "@/lib/admin-messages/oauth.en";

/** A scope as a person reads it (D439): `orders:write` → Change orders, `owner` → what only an owner may do. */
export function scopeLabel(w: OauthMessages, scope: string): string {
  if (scope === "stores:read") return w.scopes.storesRead;
  if (scope === "owner") return w.scopes.owner;
  if (Object.hasOwn(w.scopes.powers, scope)) return w.scopes.powers[scope as keyof OauthMessages["scopes"]["powers"]];
  const [area, access] = scope.split(":");
  const name = Object.hasOwn(w.areas, area) ? w.areas[area as keyof OauthMessages["areas"]] : area;
  return fillWords(access === "write" ? w.scopes.write : w.scopes.read, { area: name.toLowerCase() });
}
