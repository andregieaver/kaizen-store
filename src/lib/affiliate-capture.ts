import { holdAffiliateCode, heldAffiliateCode } from "./affiliate-memory";
import { codeFromSearch, mayKeepAffiliate, shouldCarry, withAffiliate, writeAffiliateCookie } from "./affiliates";
import { CONSENT_CHANGED_EVENT } from "./cookie-consent";

/** What the capture needs of the browser: the address, the cookie jar, the window's events and moving to an address. */
export type CaptureEnv = {
  search: string;
  origin: string;
  pathname: string;
  secure: boolean;
  readCookies: () => string;
  writeCookie: (cookie: string) => void;
  addListener: (type: string, listener: (event: never) => void, capture?: boolean) => () => void;
  navigate: (href: string) => void;
};

export type CaptureOptions = {
  storeId: string;
  storeSlug: string;
  /** Days the cookie lasts once allowed. */
  days: number;
  /** The market's own path (null on the country chooser) and the store's. */
  base: string | null;
  scope: string;
  /** Asks the server whether the code is a live affiliate's of the store, which also counts the visit. */
  verify: (code: string) => Promise<boolean>;
};

/** The parts of a click the capture reads. */
export type ClickLike = {
  defaultPrevented: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  anchor: { href: string; target: string; download: boolean } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

/**
 * Takes a friend's referral code from the address when a store's page opens (D131), and keeps it as far as the visitor
 * allows; returns what undoes it. Nothing is written to a cookie or to storage unless the consent cookie says marketing
 * was allowed, now or (by the consent event) later; the code is otherwise only in the page's memory
 * (`affiliate-memory.ts`), and links that leave the market carry it in their address, because each market is its own page
 * load. The browser-facing pieces are passed in (`CaptureEnv`) so this is the same code in the page and in the tests.
 */
export function startCapture(env: CaptureEnv, options: CaptureOptions): () => void {
  const { storeId, storeSlug, days, base, scope, verify } = options;

  const keep = (code: string) => {
    if (!mayKeepAffiliate(env.readCookies(), storeId)) return;
    const cookie = writeAffiliateCookie(storeId, code, days, env.secure);
    if (cookie) env.writeCookie(cookie);
  };

  const code = codeFromSearch(env.search);
  if (code) {
    // Held at once, so the first click to add something already carries it; dropped if the server says it is not one.
    holdAffiliateCode(storeSlug, code);
    verify(code)
      .then((live) => {
        if (live) keep(code);
        else if (heldAffiliateCode(storeSlug) === code) holdAffiliateCode(storeSlug, null);
      })
      .catch(() => {});
  }

  const onConsent = () => {
    const held = heldAffiliateCode(storeSlug);
    if (held) keep(held);
  };
  const onClick = (event: ClickLike) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const held = heldAffiliateCode(storeSlug);
    const anchor = event.anchor;
    if (!held || !anchor || (anchor.target && anchor.target !== "_self") || anchor.download) return;
    if (!shouldCarry(anchor.href, { origin: env.origin, pathname: env.pathname }, base, scope)) return;
    event.preventDefault();
    event.stopPropagation();
    env.navigate(withAffiliate(anchor.href, env.origin, held));
  };

  const stops = [env.addListener(CONSENT_CHANGED_EVENT, onConsent), env.addListener("click", onClick as never, true)];
  return () => stops.forEach((stop) => stop());
}
