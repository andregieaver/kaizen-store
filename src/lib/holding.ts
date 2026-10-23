/**
 * The holding page (D317 8, `docs/domains-standalone.md`): what a domain Kaizena Flow keeps answers with while no store uses it: a calm
 * page with its name (`parked`, the default), a permanent move to an address of the holder's choice (`redirect`), or nothing (`off`).
 * Pure: the proxy, the settings form and the tests share it.
 */

export type HoldingMode = "parked" | "redirect" | "off";
export const HOLDING_MODES: readonly HoldingMode[] = ["parked", "redirect", "off"];

/** Whether a request's host can be a held domain at all: never Kaizena Flow's own site, a preview, a store's host or a local address. */
export function mayBeHeld(host: string, own: { site: string; storeDomain: string | null }): boolean {
  const name = host.toLowerCase().split(":")[0].replace(/\.$/, "");
  if (!name || !name.includes(".") || /^[\d.]+$/.test(name) || name === "localhost" || name.endsWith(".localhost")) return false;
  if (name.endsWith(".vercel.app")) return false;
  const site = own.site.toLowerCase();
  if (name === site || name.endsWith(`.${site}`)) return false;
  const stores = own.storeDomain?.toLowerCase().split(":")[0];
  if (stores && (name === stores || name.endsWith(`.${stores}`))) return false;
  return true;
}

/** A redirect target the holder may choose: an https or http address on another host, at most 500 characters. */
export function cleanHoldingRedirect(text: string, apex: string): string | null {
  const value = text.trim();
  if (value.length > 500) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  // Never back to the domain itself: that would loop.
  if (host === apex || host.endsWith(`.${apex}`)) return null;
  return url.toString();
}

export type HoldingAnswer = { kind: "page"; apex: string; lang: "en" | "nb" } | { kind: "redirect"; to: string } | null;

/** What a held domain answers, from its zone's settings. */
export function holdingAnswer(zone: { apex: string; holding: string; redirect: string | null; country: string | null } | null): HoldingAnswer {
  if (!zone) return null;
  if (zone.holding === "redirect" && zone.redirect) return { kind: "redirect", to: zone.redirect };
  if (zone.holding !== "parked") return null;
  return { kind: "page", apex: zone.apex, lang: zone.country?.toUpperCase() === "NO" ? "nb" : "en" };
}
