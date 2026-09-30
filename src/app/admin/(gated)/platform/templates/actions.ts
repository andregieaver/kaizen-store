"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { setTemplateHidden } from "@/server/templates";

/**
 * Hides a marketplace template from every list, or shows it again (D125). Copies stores already made stay as they
 * are. Every page checks for itself that the account runs the platform.
 */
export async function setTemplateHiddenAction(id: string, hidden: boolean): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(id).success) return { status: "error", messages: ["Unknown template."] };
  const result = await setTemplateHidden(admin, id, hidden === true);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [hidden ? "Hidden. No store can find it now." : "Shown again."] };
}
