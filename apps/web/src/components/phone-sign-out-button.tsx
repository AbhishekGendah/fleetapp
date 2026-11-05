"use client";

import { SignOutButton } from "@fleetapp/ui/sign-out-button";

import { countAllQueued, forgetEverythingOnPhone } from "../lib/handover/offline/phone-tidy-up";
import { SIGN_IN_PATH } from "../lib/paths";

/** "1 photo or damage mark", "3 photos or damage marks". */
function unsentText(count: number): string {
  const things = count === 1 ? "photo or damage mark" : "photos or damage marks";
  return (
    `${count} ${things} on this phone ${count === 1 ? "hasn't" : "haven't"} been sent yet. ` +
    "Open the checklist where there is signal to send them, or sign out and lose them."
  );
}

/**
 * Sign out, wiping every checklist from this phone (review A2-11), after
 * warning if photos or damage marks are still waiting to send.
 */
export function PhoneSignOutButton(): React.JSX.Element {
  return (
    <SignOutButton
      signInHref={SIGN_IN_PATH}
      findUnsent={async () => {
        const count = await countAllQueued();
        return count > 0 ? unsentText(count) : null;
      }}
      forgetOnDevice={forgetEverythingOnPhone}
    />
  );
}
