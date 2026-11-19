"use client";

import { createContext } from "react";

/**
 * What a form that answers is working on, for the buttons inside it (code review step 1.15, D829). `ActionForm` and `QuietActionForm` call
 * their action from a transition of their own, not as the form's action, so React's `useFormStatus` does not see it: `SubmitButton` and
 * `ConfirmButton` read this as well. `data` is what was sent, the pressed button's name and value among it, as `useFormStatus` gives it.
 */
export type FormWork = { pending: boolean; data: FormData | null };

export const FormWorkContext = createContext<FormWork>({ pending: false, data: null });
