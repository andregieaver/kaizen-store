import type { ReactNode } from "react";

import type { ShopPart } from "@/lib/store-parts";

/**
 * The palette's picture of each shop component and piece (D113, D117): what it draws, so a cart, a checkout and the Cookies
 * page are told apart at a glance. Drawn as the other tiles are (a 24-pixel stroke icon on the tile's dark face); keyed by every
 * part, so a new one is a compile error until it has its picture.
 */

const line = (d: string) => <path d={d} />;
const dot = (cx: number, cy: number, r = 1) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

const cart = (
  <>
    {line("M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.7a1 1 0 0 0 1-.8L20 8H6.2")}
    <circle cx="9" cy="19" r="1.5" />
    <circle cx="17" cy="19" r="1.5" />
  </>
);
const card = (
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    {line("M3 10h18M7 15h3")}
  </>
);
const receipt = <>{line("M6 3h12v18l-3-2-3 2-3-2-3 2zM9 10l2 2 4-4")}</>;
const person = (
  <>
    <circle cx="12" cy="8" r="4" />
    {line("M4 21a8 8 0 0 1 16 0")}
  </>
);
const signIn = <>{line("M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3")}</>;
const heart = <>{line("M12 20s-7-4.5-9-9a4.5 4.5 0 0 1 9-3 4.5 4.5 0 0 1 9 3c-2 4.5-9 9-9 9z")}</>;
const repeat = <>{line("M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3")}</>;
const truck = (
  <>
    {line("M3 6h11v10H3zM14 9h4l3 3v4h-7")}
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </>
);
const cookie = (
  <>
    {line("M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3-3 3 3 0 0 1-3-3 3 3 0 0 1-3-3z")}
    {dot(8, 11)}
    {dot(12, 15)}
    {dot(8.5, 16)}
    {dot(16, 15)}
  </>
);
const folder = <>{line("M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")}</>;
const tag = (
  <>
    {line("M20 12l-8 8-9-9V3h8z")}
    {dot(7.5, 7.5, 1.5)}
  </>
);
const list = (
  <>
    {line("M9 6h12M9 12h12M9 18h12")}
    {dot(4.5, 6, 1.5)}
    {dot(4.5, 12, 1.5)}
    {dot(4.5, 18, 1.5)}
  </>
);
const gift = <>{line("M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8S10 3 7.5 4.5 9 8 12 8M12 8s2-5 4.5-3.5S15 8 12 8")}</>;
const sums = (
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    {line("M8 7h8")}
    {dot(8.5, 12)}
    {dot(12, 12)}
    {dot(15.5, 12)}
    {dot(8.5, 16)}
    {dot(12, 16)}
    {dot(15.5, 16)}
  </>
);
const percent = (
  <>
    {line("M19 5L5 19")}
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </>
);
const coins = (
  <>
    <circle cx="9" cy="9" r="6" />
    {line("M15.5 9.6A6 6 0 1 1 9.6 15.5")}
  </>
);
const forward = <>{line("M5 12h14M13 6l6 6-6 6")}</>;
const back = <>{line("M19 12H5M11 6l-6 6 6 6")}</>;
const terms = <>{line("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 15l2 2 4-4")}</>;
const done = (
  <>
    <circle cx="12" cy="12" r="9" />
    {line("M8 12l3 3 5-6")}
  </>
);
const calendar = (
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    {line("M3 10h18M8 3v4M16 3v4")}
  </>
);
const parcel = <>{line("M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8")}</>;
const documents = <>{line("M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5")}</>;
const download = <>{line("M12 3v12M7 10l5 5 5-5M5 21h14")}</>;
const pin = (
  <>
    {line("M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z")}
    <circle cx="12" cy="10" r="2.5" />
  </>
);

const padlock = (
  <>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    {line("M8 11V7a4 4 0 0 1 8 0v4")}
  </>
);

export const SHOP_PART_ICONS: Record<ShopPart, ReactNode> = {
  cart,
  checkout: card,
  order: receipt,
  account: person,
  sign_in: signIn,
  wishlist: heart,
  subscription: repeat,
  deliveries: truck,
  cookies: cookie,
  private: padlock,
  category: folder,
  tag,
  cart_lines: list,
  cart_gift: gift,
  cart_summary: sums,
  cart_code: percent,
  cart_credits: coins,
  cart_checkout: forward,
  cart_continue: back,
  checkout_items: list,
  checkout_code: percent,
  checkout_credits: coins,
  checkout_delivery: truck,
  checkout_totals: sums,
  checkout_terms: terms,
  checkout_payment: card,
  checkout_back: back,
  order_status: done,
  order_account: person,
  order_bookings: calendar,
  order_parcels: parcel,
  order_lines: list,
  order_totals: sums,
  order_documents: documents,
  order_subscription: repeat,
  order_downloads: download,
  order_address: pin,
  order_terms: terms,
  order_continue: back,
};

export function ShopPartIcon({ part }: { part: ShopPart }) {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-inverse/75 text-inverse-ink">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {SHOP_PART_ICONS[part]}
      </svg>
    </span>
  );
}
