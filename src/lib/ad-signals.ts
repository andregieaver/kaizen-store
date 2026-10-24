/**
 * The ad platforms' click and browser ids a cart keeps while its shopper allows marketing (wave 5 unit I2, D303, `docs/wave-5-marketing.md`
 * 12.3): only these keys, each checked by shape and length, never anything else the browser sends. Pseudonymous ids, so personal data: they
 * go with the cart, are copied to the order and cleared from it 90 days after its purchase was sent. No zod: imported near the cart.
 */

export const AD_SIGNAL_KEYS = ["fbp", "fbc", "gclid", "gbraid", "wbraid", "ttclid", "ttp", "epik"] as const;
export type AdSignalKey = (typeof AD_SIGNAL_KEYS)[number];
export type AdSignals = Partial<Record<AdSignalKey, string>>;

/** Each id's shape: Meta's `fb.1.<ms>.<random>`, Google's and TikTok's click ids, TikTok's browser id, Pinterest's `epik`. */
const SHAPES: Record<AdSignalKey, RegExp> = {
  fbp: /^fb\.\d\.\d{10,16}\.\d{1,20}$/,
  fbc: /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{8,500}$/,
  gclid: /^[A-Za-z0-9_-]{10,200}$/,
  gbraid: /^[A-Za-z0-9_-]{10,200}$/,
  wbraid: /^[A-Za-z0-9_-]{10,200}$/,
  ttclid: /^[A-Za-z0-9_.-]{10,200}$/,
  ttp: /^[A-Za-z0-9_.-]{10,100}$/,
  epik: /^[A-Za-z0-9_.=-]{10,300}$/,
};

/** Only the known keys whose values fit their shape; anything else is dropped without a word. */
export function cleanAdSignals(input: unknown): AdSignals {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: AdSignals = {};
  for (const key of AD_SIGNAL_KEYS) {
    const value = (input as Record<string, unknown>)[key];
    if (typeof value === "string" && SHAPES[key].test(value.trim())) out[key] = value.trim();
  }
  return out;
}

/** Reads the ids from the browser's cookies and the page's address (the click ids arrive in the address), for the consent manager. */
export function readAdSignals(cookie: string, search: string): AdSignals {
  const jar = new Map(cookie.split("; ").map((pair) => [pair.slice(0, pair.indexOf("=")), decodeURIComponent(pair.slice(pair.indexOf("=") + 1))]));
  const params = new URLSearchParams(search);
  return cleanAdSignals({
    fbp: jar.get("_fbp"),
    fbc: jar.get("_fbc") ?? (params.get("fbclid") ? `fb.1.${Date.now()}.${params.get("fbclid")}` : undefined),
    gclid: params.get("gclid") ?? undefined,
    gbraid: params.get("gbraid") ?? undefined,
    wbraid: params.get("wbraid") ?? undefined,
    ttclid: params.get("ttclid") ?? undefined,
    ttp: jar.get("_ttp"),
    epik: params.get("epik") ?? jar.get("_epik"),
  });
}
