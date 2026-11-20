"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { HEAT_DEVICES, type HeatDevice } from "@/lib/page-heat";
import { HEATMAPS_WORDS } from "@/lib/admin-words/heatmaps";
import { audit } from "@/server/auth";
import { requestMapShot } from "@/server/map-shots";
import { storeAction } from "@/server/store-action";

const failed = (message: string): FormState => ({ status: "error", messages: [message] });

/** Asks for a new picture of a page on a device (D656, `docs/heatmaps-and-recordings.md` 9.1): `analytics:write`, audited. */
export async function takeNewPictureAction(storeSlug: string, page: string, device: string, tag: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "analytics:write", action: "analytics.map_shot_requested", answer: failed }, async (member, lang) => {
    const w = HEATMAPS_WORDS[lang].map;
    if (!(HEAT_DEVICES as readonly string[]).includes(device) || !/^\/[a-z0-9-]{2,40}(\/.*)?$/.test(page) || page.length > 300) return failed(w.noPicture);
    await requestMapShot(member.store.id, page, device as HeatDevice, tag === "" || /^[0-9a-f-]{36}:[a-d]$/.test(tag) ? tag : "", true);
    await audit(member.account.id, member.store.id, "analytics.map_shot_requested", { device });
    refresh();
    return { status: "ok", messages: [w.newPictureAsked] };
  });
}
