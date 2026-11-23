import { FORM_LOOK_CSS } from "@/lib/form-look-css";

/**
 * The stylesheet of forms drawn in an owner's style (D878), beside the form that needs it: React 19 hoists a `<style>` with `href` and
 * `precedence` into the head and keeps one per page, however many forms draw it. Only a form with a field style draws it.
 */
export function FormLookStyle() {
  return (
    <style href="kf-form-look" precedence="medium">
      {FORM_LOOK_CSS}
    </style>
  );
}
