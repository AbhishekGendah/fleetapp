/** What a small form or button that changes a record came back with. */
export type ChangeFormState =
  | { status: "editing" }
  | { status: "saved"; message: string; isWarning: boolean; link?: FormResultLink }
  | { status: "failed"; formError: string; link?: FormResultLink };

/** A way on from a refusal, e.g. to the record that already exists. */
export interface FormResultLink {
  href: string;
  label: string;
}

export const INITIAL_CHANGE_STATE: ChangeFormState = { status: "editing" };

export function savedState(
  message: string,
  isWarning = false,
  link?: FormResultLink,
): ChangeFormState {
  return link
    ? { status: "saved", message, isWarning, link }
    : { status: "saved", message, isWarning };
}

export function failedState(formError: string, link?: FormResultLink): ChangeFormState {
  return link ? { status: "failed", formError, link } : { status: "failed", formError };
}
