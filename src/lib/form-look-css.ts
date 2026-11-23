/**
 * A page's form fields drawn in the owner's style (D878, `src/lib/form-field-style.ts`): the `.kf-*` classes `SiteForm` gives its fields,
 * read from the data attributes and `--kf-*` custom properties of its form. Not in the site's stylesheet: a page that draws a styled form
 * carries it once (`FormLookStyle`, a `<style>` React hoists and keeps once per page), so the stylesheet budgets of pages without one do not
 * pay for it. Every property not set falls back to the theme's; every rule is scoped to `.kf-fields`.
 */
export const FORM_LOOK_CSS = `
.kf-fields,
.kf-fields .kf-grid {
  gap: var(--kf-gap, 1rem);
}
.kf-fields .kf-ctl,
.kf-fields .kf-file {
  border: var(--kf-bw, 1px) solid var(--kf-line, var(--border));
  border-radius: var(--kf-radius, 0.375rem);
  background-color: var(--kf-bg, var(--background));
  color: var(--kf-ink, inherit);
  font-size: var(--kf-size, 1rem);
}
.kf-fields .kf-ctl {
  width: 100%;
  min-height: 2.75rem;
  padding: var(--kf-py, 0) var(--kf-px, 0.75rem);
  line-height: 1.5;
}
.kf-fields textarea.kf-ctl {
  padding-block: var(--kf-py, 0.5rem);
}
.kf-fields .kf-drop {
  min-height: 3rem;
  border-radius: var(--kf-radius, var(--button-radius));
  padding-block: var(--kf-py, 0.5rem);
}
.kf-fields .kf-file {
  padding-inline: var(--kf-px, 0.75rem);
}
.kf-fields[data-kf-look="filled"] :is(.kf-ctl, .kf-file) {
  border-color: var(--kf-line, transparent);
  background-color: var(--kf-bg, color-mix(in srgb, var(--foreground) 6%, var(--background)));
}
.kf-fields[data-kf-look="underline"] .kf-ctl {
  border-width: 0 0 var(--kf-bw, 1px);
  border-radius: 0;
  background-color: var(--kf-bg, transparent);
  padding-inline: var(--kf-px, 0);
}
.kf-fields .kf-label {
  color: var(--kf-label, inherit);
}
.kf-fields[data-kf-phc] .kf-ctl::placeholder {
  color: var(--kf-ph);
  opacity: 1;
}
.kf-fields[data-kf-focus] .kf-ctl:focus {
  border-color: var(--kf-focus);
  outline: 2px solid color-mix(in srgb, var(--kf-focus) 35%, transparent);
  outline-offset: 0;
}
.kf-fields[data-kf-focus] :is(input[type="checkbox"], input[type="radio"]) {
  accent-color: var(--kf-focus);
}

.kf-fields[data-kf-labels="animated"] .kf-box {
  position: relative;
  margin-top: calc(var(--kf-moved, 11px) * 1.3 + var(--kf-lift, 6px));
}
.kf-fields .kf-float {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: calc(var(--kf-bw, 1px) + var(--kf-px, 0.75rem));
  display: grid;
  max-width: calc(100% - 2 * (var(--kf-bw, 1px) + var(--kf-px, 0.75rem)));
  overflow: hidden;
  pointer-events: none;
  transform: translateY(-50%);
  color: var(--kf-ph, var(--muted));
  font-size: var(--kf-size, 1rem);
  font-weight: 400;
  line-height: 1.5;
  letter-spacing: 0;
  white-space: nowrap;
  transition-duration: var(--kf-dur, 220ms);
  transition-property: top, left, transform, font-size, letter-spacing, color;
  transition-timing-function: var(--kf-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
.kf-fields[data-kf-look="underline"] .kf-float {
  left: var(--kf-px, 0);
}
.kf-fields .kf-box:has(textarea) .kf-float {
  top: calc(var(--kf-bw, 1px) + var(--kf-py, 0.5rem));
  transform: none;
}
.kf-fields .kf-float > span {
  grid-area: 1 / 1;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity calc(var(--kf-dur, 220ms) * 0.7) var(--kf-ease, cubic-bezier(0.2, 0.7, 0.2, 1));
}
.kf-fields .kf-float > .kf-up {
  opacity: 0;
  text-transform: uppercase;
}
.kf-fields:is([data-kf-case="switch"], [data-kf-case="keep"]) .kf-float > .kf-up {
  display: none;
}
.kf-fields .kf-box:is(:focus-within, [data-moved]) .kf-float {
  top: 0;
  left: 0;
  transform: translateY(calc(-100% - var(--kf-lift, 6px)));
  color: var(--kf-label, inherit);
  font-size: var(--kf-moved, 11px);
  font-weight: 600;
  letter-spacing: var(--kf-track, 0.08em);
}
.kf-fields[data-kf-align="text"] .kf-box:is(:focus-within, [data-moved]) .kf-float {
  left: calc(var(--kf-bw, 1px) + var(--kf-px, 0.75rem));
}
.kf-fields[data-kf-align="text"][data-kf-look="underline"] .kf-box:is(:focus-within, [data-moved]) .kf-float {
  left: var(--kf-px, 0);
}
.kf-fields[data-kf-focus] .kf-box:focus-within .kf-float {
  color: var(--kf-focus);
}
.kf-fields:not([data-kf-case]) .kf-box:is(:focus-within, [data-moved]) .kf-float > .kf-rg {
  opacity: 0;
}
.kf-fields:not([data-kf-case]) .kf-box:is(:focus-within, [data-moved]) .kf-float > .kf-up {
  opacity: 1;
}
.kf-fields[data-kf-case="switch"] .kf-box:is(:focus-within, [data-moved]) .kf-float > .kf-rg {
  text-transform: uppercase;
}
.kf-fields[data-kf-labels="animated"] .kf-box .kf-ctl::placeholder {
  color: transparent;
}
.kf-fields[data-kf-labels="animated"]:not([data-kf-ph]) .kf-box:focus-within .kf-ctl::placeholder {
  color: var(--kf-ph, color-mix(in srgb, currentColor 50%, transparent));
  transition: color 0.15s calc(var(--kf-dur, 220ms) * 0.6);
}
.kf-fields .kf-box:not([data-moved], :focus-within) .kf-drop > span {
  visibility: hidden;
}
@media (prefers-reduced-motion: reduce) {
  .kf-fields .kf-float,
  .kf-fields .kf-float > span {
    transition-duration: 1ms;
  }
}
`.replace(/\s+/g, " ").trim();
