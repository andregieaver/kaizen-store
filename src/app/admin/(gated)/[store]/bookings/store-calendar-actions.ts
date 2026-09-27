import {
  addBlockAction,
  addFeedAction,
  removeBlockAction,
  removeFeedAction,
  resetCalendarAction,
  syncFeedAction,
} from "./actions";
import type { CalendarActions } from "./resource-calendar";

/** The store's own actions for a resource's calendar panel. */
export function storeCalendarActions(storeSlug: string, resourceId: string): CalendarActions {
  return {
    addBlock: addBlockAction.bind(null, storeSlug, resourceId),
    removeBlock: removeBlockAction.bind(null, storeSlug),
    resetCalendar: resetCalendarAction.bind(null, storeSlug, resourceId),
    addFeed: addFeedAction.bind(null, storeSlug, resourceId),
    syncFeed: syncFeedAction.bind(null, storeSlug),
    removeFeed: removeFeedAction.bind(null, storeSlug),
  };
}
