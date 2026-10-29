/** What a small form on the car page came back with. */
export type CarPageFormState =
  | { status: "editing" }
  | { status: "saved"; message: string; isWarning: boolean }
  | { status: "failed"; formError: string };

export const CAR_PAGE_INITIAL_STATE: CarPageFormState = { status: "editing" };
