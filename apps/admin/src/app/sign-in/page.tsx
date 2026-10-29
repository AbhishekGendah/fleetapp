"use client";

import {
  signInWithPassword,
  verifyAuthenticatorCode,
  verifyRecoveryCode,
} from "@fleetapp/auth/client";
import { SignInForm } from "@fleetapp/ui/sign-in-form";
import { useRouter } from "next/navigation";

import { ADMIN_LABEL } from "../admin-label";
import { HOME_PATH } from "../../lib/paths";

export default function SignInPage() {
  const router = useRouter();

  // Refreshed as well as moved, so no page cached from before signing in is shown.
  function handleSignedIn(): void {
    router.push(HOME_PATH);
    router.refresh();
  }

  return (
    <SignInForm
      description="Altus Global Solutions platform admin."
      logoLabel={ADMIN_LABEL}
      signInWithPassword={signInWithPassword}
      // No trusted devices for Admins: no tick box, so a code on every sign-in.
      verifyCode={(code) => verifyAuthenticatorCode(code)}
      verifyRecoveryCode={(code) => verifyRecoveryCode(code)}
      onSignedIn={handleSignedIn}
    />
  );
}
