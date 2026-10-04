/** The path matcher Next.js compiles into itself, which turns a `source` of `headers()` into a regular expression (used by the tests that hold the pay routes' sources to the addresses they must match). */
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(path: string): RegExp;
}
