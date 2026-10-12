/** The slide after or before `index`, going round. Apart from `gallery.ts` so the browser's carousels need no page model. */
export const stepSlide = (index: number, by: 1 | -1, count: number): number => (count === 0 ? 0 : (index + by + count) % count);
