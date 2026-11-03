/**
 * Where this phone remembers the payments link it came from, so Stripe's
 * page can send the Renter back without the link's secret ever going to
 * Stripe. Kept for this browser tab only.
 */
export const RETURN_TO_KEY = "renter-payments-link";

/** Added to the link's address on the way back from Stripe: how the visit ended. */
export const BACK_FROM_STRIPE_PARAM = "back";
