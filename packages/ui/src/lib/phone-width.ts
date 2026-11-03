"use client";

import { useSyncExternalStore } from "react";

/** Below the `sm` breakpoint: laid out for a phone first (rule 24). */
export const PHONE_WIDTH_QUERY = "(max-width: 639px)";

/** Whether the screen is phone width now (false on the server). */
export function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_WIDTH_QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_WIDTH_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the screen is phone width, kept up to date as the window is resized or turned. */
export function useIsPhoneWidth(): boolean {
  return useSyncExternalStore(subscribe, isPhoneWidth, () => false);
}
