import type { ReactNode } from "react";

/** The slide-out cart's slot (D64) lives here, one level under the market layout: a slot on a root layout makes Next draw that layout twice (bloat review step 2.2). */
export default function ShopLayout({ children, drawer }: { children: ReactNode; drawer: ReactNode }) {
  return (
    <>
      {children}
      {drawer}
    </>
  );
}
