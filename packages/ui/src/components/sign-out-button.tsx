"use client";

import { signOut } from "@fleetapp/auth/client";
import { lazy, Suspense, useState } from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { Button } from "./button";

// Loaded only when there is something to warn about, so every page stays small.
const UnsentWarning = lazy(() => import("./unsent-warning"));

interface SignOutButtonProps {
  signInHref: string;
  /**
   * What would be lost by signing out on this device, if anything (e.g.
   * photos not yet sent). When there is something, the person is asked first.
   */
  findUnsent?: () => Promise<string | null>;
  /** Wipes what this device keeps for the signed-in session, once signed out. */
  forgetOnDevice?: () => Promise<void>;
}

/**
 * Signs out, then loads the sign-in page afresh. A full page load rather than
 * an in-app move, so nothing from the signed-in session stays in memory.
 */
export function SignOutButton(props: SignOutButtonProps): React.JSX.Element {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);
  useCloseOnBack(unsent !== null, () => setUnsent(null));

  async function signOutNow(): Promise<void> {
    setIsSigningOut(true);
    await signOut();
    try {
      await props.forgetOnDevice?.();
    } catch (error) {
      // Signed out regardless: the week's limit wipes it later.
      console.error(
        "Wiping this device at sign-out failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    window.location.assign(props.signInHref);
  }

  async function handleSignOut(): Promise<void> {
    const found = (await props.findUnsent?.()) ?? null;
    if (found) {
      setUnsent(found);
      return;
    }
    await signOutNow();
  }

  return (
    <>
      <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? "Signing out…" : "Sign out"}
      </Button>
      {unsent !== null ? (
        <Suspense fallback={null}>
          <UnsentWarning
            message={unsent}
            isSigningOut={isSigningOut}
            onStay={() => setUnsent(null)}
            onSignOut={signOutNow}
          />
        </Suspense>
      ) : null}
    </>
  );
}
