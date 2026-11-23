import { MIN_PER_ARM } from "./experiment-stats";

/**
 * The sizes of a broadcast's split test (email plan M2.5, D868), apart from the engine, so the editor reads them without loading it.
 */

/** The share of the audience tested, in percent: 20 by default, 10 to 50 under Customise. */
export const TEST_SHARE = { start: 20, min: 10, max: 50 } as const;
/** The hours to wait before the call: 4 by default, 1 to 24. */
export const TEST_HOURS = { start: 4, min: 1, max: 24 } as const;
/** Readers each version needs before a difference is read: the engine's floor. */
export const TEST_FLOOR = MIN_PER_ARM;

/** How many readers of an audience are tested (split evenly between the two versions); the rest are held for the winner. */
export const testedOf = (audience: number, share: number): number => Math.floor((audience * share) / 100);

/** The least audience whose tested share gives each version the floor. */
export const audienceNeeded = (share: number): number => Math.ceil((2 * TEST_FLOOR * 100) / share);
