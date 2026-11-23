"use client";

import dynamic from "next/dynamic";

import { lazyView } from "@/components/lazy/lazy-view";

/**
 * The stylesheet of forms in an owner's field style (D878) for the builder's canvas, loaded only when a styled form is on it: its text
 * would otherwise ride in the builder's first scripts.
 */
export const FormLookStyle = lazyView(dynamic(() => import("@/components/form-look-style").then((m) => m.FormLookStyle)));
