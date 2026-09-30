/**
 * Where Work lives in the admin (D123): at the store owner's level, one place
 * for every store's clients, hours and invoices. `/admin/account/work` is the
 * combined view; one store's own screens are under `/admin/account/work/s/{store}`
 * (`s` is shorter than any store address, so no store can take it). Build every
 * Work link with these, never by hand.
 */
export const WORK_ROOT = "/admin/account/work";

/** One store's Work, for example `${workBase("acme")}/clients`. */
export function workBase(storeSlug: string): string {
  return `${WORK_ROOT}/s/${storeSlug}`;
}

/**
 * Work's old store-level addresses (D122) and where they went (D123), as Next's
 * `redirects` (`next.config.ts`). The first segment must not be `account` or
 * `platform`, or `/admin/account/work` would match `/admin/:store/work` and
 * redirect to itself. A redirect names no data: the page it lands on checks
 * that the person is a member of the store (`requireMember()`).
 */
export const LEGACY_WORK_REDIRECTS: readonly { source: string; destination: string; permanent: false }[] = [
  { source: "/admin/:store((?!account/|platform/)[^/]+)/settings/work", destination: `${WORK_ROOT}/s/:store/settings`, permanent: false },
  { source: "/admin/:store((?!account/|platform/)[^/]+)/work", destination: `${WORK_ROOT}/s/:store`, permanent: false },
  { source: "/admin/:store((?!account/|platform/)[^/]+)/work/:path+", destination: `${WORK_ROOT}/s/:store/:path+`, permanent: false },
];
