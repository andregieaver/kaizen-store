"use client";

import { Suspense, type ComponentType, type ReactNode } from "react";

/**
 * A client component loaded only where it is drawn (D211). Every client component a route's server code imports joins one group of
 * scripts that every page of the route loads, drawn or not; one made with `next/dynamic` is a script of its own. The server still
 * draws it into the page and asks the browser for its script with the page's own (`PreloadChunks`), so it is ready when the page
 * wakes up; while the page hydrates React keeps the server's HTML. `fallback` is what shows when it is first drawn in the browser
 * (after a client navigation): nothing, or the children it wraps. The `import()` must be written inside `dynamic()` in each
 * `lazy/*.tsx`, as Next finds the scripts to preload by it.
 */
export function lazyView<P extends object>(View: ComponentType<P>, fallback: (props: P) => ReactNode = () => null) {
  function LazyView(props: P) {
    return (
      <Suspense fallback={fallback(props)}>
        <View {...props} />
      </Suspense>
    );
  }
  return LazyView;
}

/** The fallback of a component that wraps the server's content: the content itself. */
export const showChildren = (props: { children?: ReactNode }) => props.children;
