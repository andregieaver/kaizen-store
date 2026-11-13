"use client";

import { useContext } from "react";

import { signInEn } from "@/lib/admin-messages/sign-in.en";
import type { AdminAreaMessages } from "@/lib/admin-text";

import { AdminTextContext } from "./admin-text-context";

/**
 * The sign-in words, in English unless handed down: on the signed-out pages as in the admin (PERF-11).
 * Its own module, imported only by the two-step panel and the recovery codes, so sign-in's English (8.4 KB) is not in every screen's first scripts (bloat review step 0.9).
 */
export function useSignInText(): AdminAreaMessages["signIn"] {
  return useContext(AdminTextContext).texts.signIn ?? signInEn;
}
