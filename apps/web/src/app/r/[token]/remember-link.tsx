"use client";

import { useEffect } from "react";

import { RETURN_TO_KEY } from "./payments-return";

/** Remembers this page for this tab, for the way back from Stripe's page. */
export function RememberLink() {
  useEffect(() => {
    try {
      window.sessionStorage.setItem(RETURN_TO_KEY, window.location.pathname);
    } catch (error) {
      // Private browsing can refuse storage: the Renter opens the emailed link instead.
      console.warn("Remembering the link failed", error instanceof Error ? error.name : "");
    }
  }, []);
  return null;
}
