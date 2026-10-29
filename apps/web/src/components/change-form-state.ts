/** What a small form or button that changes a record came back with. */
export type ChangeFormState =
  | { status: "editing" }
  | { status: "saved"; message: string; isWarning: boolean }
  | { status: "failed"; formError: string };

export const INITIAL_CHANGE_STATE: ChangeFormState = { status: "editing" };

export function savedState(message: string, isWarning = false): ChangeFormState {
  return { status: "saved", message, isWarning };
}

export function failedState(formError: string): ChangeFormState {
  return { status: "failed", formError };
}
