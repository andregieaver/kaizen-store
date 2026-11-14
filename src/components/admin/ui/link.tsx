"use client";

import { PolicyLink, type LinkPolicy } from "@/components/policy-link";
import type { ComponentProps } from "react";
import type Link from "next/link";

export type AdminLinkProps = Omit<ComponentProps<typeof Link>, "prefetch"> & {
  policy?: LinkPolicy;
  /** As next/link's: false means policy none. Kept so a caller's prefetch={false} still type-checks. */
  prefetch?: false;
};

/** The admin's link: fetched on intent unless a policy is given. The rail, the menus and the list primitives use it, so an admin screen at rest prefetches nothing. */
export function AdminLink({ policy, prefetch, ...rest }: AdminLinkProps) {
  return <PolicyLink policy={policy ?? (prefetch === false ? "none" : "intent")} {...rest} />;
}
