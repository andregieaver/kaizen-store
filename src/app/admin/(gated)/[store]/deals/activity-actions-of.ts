import type { ActivityActions } from "@/components/admin/activities/activities-card";
import { listStaff } from "@/server/settings";

import { activityDoneAction, addActivityAction, changeActivityAction, deleteActivityAction } from "./activity-actions";

/** Activities' actions (S3, D468) bound to one store, for the pages of a member who may change customers. */
export function activityActions(storeSlug: string): Required<ActivityActions> {
  return {
    add: addActivityAction.bind(null, storeSlug),
    change: (id) => changeActivityAction.bind(null, storeSlug, id),
    remove: (id) => deleteActivityAction.bind(null, storeSlug, id),
    done: (id, done) => activityDoneAction.bind(null, storeSlug, id, done),
  };
}

/** Who an activity may be for: the store's team whose access is on and has not ended. */
export async function activityTeam(storeId: string): Promise<{ id: string; name: string }[]> {
  const now = new Date().toISOString();
  return (await listStaff(storeId)).filter((s) => !s.disabled && (!s.expiresAt || s.expiresAt > now)).map((s) => ({ id: s.accountId, name: s.name || s.email }));
}
