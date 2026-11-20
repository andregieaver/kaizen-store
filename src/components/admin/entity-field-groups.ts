import { groupApplies, type Facts, type FieldGroup } from "@/lib/custom-fields";

/**
 * The groups of a store's custom fields (D118) that apply to what is being edited, as it is now (unsaved changes count). A module of its own
 * (bloat review step 2.30), so the page editor reads it without the fields form, which loads where it is drawn.
 */
export const applicableGroups = (groups: FieldGroup[], facts: Facts): FieldGroup[] => groups.filter((group) => groupApplies(group, facts));
