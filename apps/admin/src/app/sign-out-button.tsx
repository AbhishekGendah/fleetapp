"use client";

import { Button } from "@fleetapp/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../lib/auth-client";
import { SIGN_IN_PATH } from "../lib/paths";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setIsSigningOut(true);
    await authClient.signOut();
    router.push(SIGN_IN_PATH);
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={handleSignOut} disabled={isSigningOut}>
      {isSigningOut ? "Signing out…" : "Sign out"}
    </Button>
  );
}
