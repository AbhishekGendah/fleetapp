"use client";

import {
  signInWithPassword,
  verifyAuthenticatorCode,
  verifyRecoveryCode,
} from "@fleetapp/auth/client";
import { SignInForm } from "@fleetapp/ui/sign-in-form";
import { useRouter } from "next/navigation";

import { FORGOT_PASSWORD_PATH, HOME_PATH } from "../../lib/paths";
import { TRUSTED_DEVICE_DAYS } from "../../lib/trusted-device-policy";

export default function SignInPage() {
  const router = useRouter();

  function handleSignedIn(): void {
    router.push(HOME_PATH);
    router.refresh();
  }

  return (
    <SignInForm
      description="Sign in to manage your fleet."
      signInWithPassword={signInWithPassword}
      verifyCode={verifyAuthenticatorCode}
      verifyRecoveryCode={verifyRecoveryCode}
      trustDeviceLabel={`Remember this device for ${TRUSTED_DEVICE_DAYS} days`}
      forgotPasswordHref={FORGOT_PASSWORD_PATH}
      onSignedIn={handleSignedIn}
    />
  );
}
