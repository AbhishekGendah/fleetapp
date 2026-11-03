"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { RENTER_LINK_PATH } from "../../../lib/paths";
import { BACK_FROM_STRIPE_PARAM, RETURN_TO_KEY } from "../[token]/payments-return";

/** Only a link page of ours is ever gone back to, never an address from elsewhere. */
const LINK_PAGE = new RegExp(`^${RENTER_LINK_PATH}/[A-Za-z0-9_-]+$`);

/** The link this tab remembered, if it is one of ours; null if none. */
function rememberedLink(): string | null {
  try {
    const path = window.sessionStorage.getItem(RETURN_TO_KEY);
    return path && LINK_PAGE.test(path) ? path : null;
  } catch (error) {
    console.warn("Reading the link to go back to failed", error instanceof Error ? error.name : "");
    return null;
  }
}

/** The tab's storage does not change while this page is open. */
function subscribeToNothing(): () => void {
  return () => undefined;
}

/** Back to the payments link this tab came from, saying how Stripe's page ended. */
export function BackToLink() {
  const router = useRouter();
  const step = useSearchParams().get("step") ?? "";
  // Undefined on the server, where there is no tab to remember anything.
  const path = useSyncExternalStore(subscribeToNothing, rememberedLink, () => undefined);

  useEffect(() => {
    if (path) {
      router.replace(`${path}?${new URLSearchParams({ [BACK_FROM_STRIPE_PARAM]: step })}`);
    }
  }, [router, path, step]);

  return (
    <p role="status" className="text-sm">
      {path === null
        ? "This phone does not remember the link. Open it again from your email: everything you did on Stripe's page is kept."
        : "One moment…"}
    </p>
  );
}
