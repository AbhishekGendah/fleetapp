"use client";

import { signOut } from "@fleetapp/auth/client";
import { useState } from "react";

import { Button } from "./button";

/**
 * Signs out, then loads the sign-in page afresh. A full page load rather than
 * an in-app move, so nothing from the signed-in session stays in memory.
 */
export function SignOutButton(props: { signInHref: string }): React.JSX.Element {
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);
    await signOut();
    window.location.assign(props.signInHref);
  }

  return (
    <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}
