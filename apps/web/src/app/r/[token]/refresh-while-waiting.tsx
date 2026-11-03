"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const REFRESH_EVERY_MS = 5_000;
/** About two minutes: Stripe's word normally comes within seconds. */
const MOST_REFRESHES = 24;

/** Looks again every few seconds while Stripe has not yet told us how it went. */
export function RefreshWhileWaiting() {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      router.refresh();
      if (count >= MOST_REFRESHES) {
        window.clearInterval(timer);
      }
    }, REFRESH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}
