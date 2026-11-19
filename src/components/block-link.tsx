import type { AnchorHTMLAttributes } from "react";

import { isPayPath } from "@/lib/pay-routes";

import { PolicyLink } from "./policy-link";

/** Paths that are the app's but not a page a press may reach inside it: its API, the admin, sign-in, the authorization server and short links. */
const HANDLERS = ["/api/", "/admin", "/auth/", "/oauth/", "/r/"];

/**
 * Whether a built page's link is an address of the app that a press may reach without a new document (bloat review step 2.7): one path on this
 * site (one leading `/`), not a pay path (`isPayPath()`, `docs/pci.md`), not a handler (`HANDLERS`) and not a file (an extension on its last segment).
 */
export function isAppAddress(href: string): boolean {
  if (!/^\/(?!\/)/.test(href)) return false;
  if (isPayPath(href)) return false;
  const path = href.split(/[?#]/)[0];
  if (HANDLERS.some((handler) => path.startsWith(handler))) return false;
  const lastSegment = path.split("/").pop() ?? "";
  return !/\.[a-z0-9]{2,5}$/i.test(lastSegment);
}

/**
 * Built pages' links (D54) stay in the app for an address of the app, fetched on intent (`PolicyLink`); a pay path is always a full page load
 * (docs/pci.md), as are files, handlers, new tabs and other sites, and `plain` (the builder's canvas) draws the plain anchor too. Every other
 * attribute passes through unchanged in both branches.
 */
export function BlockLink({ href, plain = false, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; plain?: boolean }) {
  if (plain || rest.target || !isAppAddress(href)) return <a href={href} {...rest} />;
  return <PolicyLink policy="intent" href={href} {...rest} />;
}
