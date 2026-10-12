import { z } from "zod";

import { MENU_HOVER_EDGES, MENU_HOVER_KINDS, MENU_HOVER_TRAVEL, MENU_LINE_MAX, MENU_RADIUS_MAX, type MenuHoverEdge, type MenuHoverKind, type MenuHoverTravel } from "./menu-hover";

/**
 * The schemas of `menu-hover.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A colour is written as # and six hex digits, like #1f2937.").transform((v) => v.toLowerCase());

export const menuHoverSchema = z
  .object({
    kind: z.enum(Object.keys(MENU_HOVER_KINDS) as [MenuHoverKind, ...MenuHoverKind[]]),
    edge: z.enum(Object.keys(MENU_HOVER_EDGES) as [MenuHoverEdge, ...MenuHoverEdge[]]).optional(),
    travel: z.enum(Object.keys(MENU_HOVER_TRAVEL) as [MenuHoverTravel, ...MenuHoverTravel[]]).optional(),
    thickness: z.number().int().min(1).max(MENU_LINE_MAX, `A line is at most ${MENU_LINE_MAX} pixels thick.`).optional(),
    color: hex.optional(),
    gradient: z.object({ colors: z.array(hex).min(2).max(4), angle: z.number().int().min(0).max(360) }).optional(),
    textColor: hex.optional(),
    radius: z.number().int().min(0).max(MENU_RADIUS_MAX).optional(),
    active: z.boolean().optional(),
  })
  .optional();
