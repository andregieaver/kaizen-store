/**
 * Only `scroll()` from the `motion` package, in a module of its own so that loading it (by the runtime, in browsers without
 * CSS scroll timelines) brings just that function and not the whole package.
 */
export { scroll } from "motion";
