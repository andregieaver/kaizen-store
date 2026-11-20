"use client";

import dynamic from "next/dynamic";

import { AccountTabsView, type AccountTabsProps } from "../account-tabs-view";
import { lazyView } from "./lazy-view";

/**
 * My account's forms and tabs, loaded only where they are drawn (D211, `lazyView()`): one module per group of the shop's stand-ins, so a
 * route carries only the stand-ins it draws (bloat review step 2.9, commit 3). Signing in is not here: what is typed before a part's own
 * script runs is lost (`docs/performance.md`).
 */
export const DetailsForm = lazyView(dynamic(() => import("../account-forms").then((m) => m.DetailsForm)));
export const PasswordForm = lazyView(dynamic(() => import("../account-forms").then((m) => m.PasswordForm)));
// My account's tabs (D480): until their script is here (after a move within the site), the tab the address names, drawn as it stands.
export const AccountTabs = lazyView(
  dynamic(() => import("../account-tabs").then((m) => m.AccountTabs)),
  ({ initial, ...props }: AccountTabsProps) => <AccountTabsView {...props} active={initial} />,
);
export const SignOutButton = lazyView(dynamic(() => import("../account-forms").then((m) => m.SignOutButton)));
export const AvatarPicker = lazyView(dynamic(() => import("../avatar-picker").then((m) => m.AvatarPicker)));
