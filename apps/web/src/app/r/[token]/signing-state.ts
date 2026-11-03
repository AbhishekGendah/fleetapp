/** What signing the contract came back with, for the Renter's link page. */
export type SignState =
  | { status: "idle" }
  | {
      status: "signed";
      signedAtText: string;
      /** The payments link the Renter carries on to, and this phone's pass for it. */
      paymentsNext: { token: string; deviceToken: string } | null;
    }
  | { status: "problem"; message: string };

export const INITIAL_SIGN_STATE: SignState = { status: "idle" };
