"use client";

import { signOut } from "@fleetapp/auth/client";
import { lazy, Suspense, useState } from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { Button } from "./button";

const NO_SIGNAL_MESSAGE =
  "Couldn't reach us to sign out. This device has been cleared; try again when there is signal.";
const UNKNOWN_UNSENT_MESSAGE =
  "This device couldn't check for photos or damage marks not yet sent. Signing out may lose them.";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

// Loaded only when there is something to warn about, so every page stays small.
const UnsentWarning = lazy(() => import("./unsent-warning"));

interface SignOutButtonProps {
  signInHref: string;
  /**
   * What would be lost by signing out on this device, if anything (e.g.
   * photos not yet sent). When there is something, the person is asked first.
   */
  findUnsent?: () => Promise<string | null>;
  /** Wipes what this device keeps for the signed-in session, before signing out. */
  forgetOnDevice?: () => Promise<void>;
}

/**
 * Signs out, then loads the sign-in page afresh. A full page load rather than
 * an in-app move, so nothing from the signed-in session stays in memory.
 */
export function SignOutButton(props: SignOutButtonProps): React.JSX.Element {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [unsent, setUnsent] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useCloseOnBack(unsent !== null, () => setUnsent(null));

  async function signOutNow(): Promise<void> {
    setIsSigningOut(true);
    // Wiped first: a phone with no signal must not keep a Renter's details
    // because the sign-out itself couldn't reach us.
    try {
      await props.forgetOnDevice?.();
    } catch (error) {
      console.error("Wiping this device at sign-out failed", errorName(error));
    }
    try {
      await signOut();
    } catch (error) {
      console.error("Signing out couldn't reach the server", errorName(error));
      setUnsent(null);
      setProblem(NO_SIGNAL_MESSAGE);
      setIsSigningOut(false);
      return;
    }
    window.location.assign(props.signInHref);
  }

  async function handleSignOut(): Promise<void> {
    setProblem(null);
    let found: string | null;
    try {
      found = (await props.findUnsent?.()) ?? null;
    } catch (error) {
      // Can't tell what is waiting: say so, rather than sign out silently or not at all.
      console.error("Checking this device for unsent items failed", errorName(error));
      found = UNKNOWN_UNSENT_MESSAGE;
    }
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
      {problem ? (
        <p role="alert" className="text-destructive max-w-48 text-xs">
          {problem}
        </p>
      ) : null}
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
