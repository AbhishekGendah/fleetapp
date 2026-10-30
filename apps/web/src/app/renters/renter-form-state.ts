/** What saving the Renter form came back with. A saved Renter goes straight to their page. */
export type RenterFormState = { status: "editing" } | { status: "failed"; formError: string };

export const RENTER_NOT_FOUND_MESSAGE =
  "That Renter could not be found. They may have been archived.";
