"use client";

import { AuthenticatorSetup, type AuthenticatorEnrolment } from "@fleetapp/ui/authenticator-setup";
import { useRouter } from "next/navigation";

import { authClient } from "../../lib/auth-client";
import { HOME_PATH } from "../../lib/paths";

async function enableAuthenticator(password: string): Promise<AuthenticatorEnrolment | null> {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error || !data || !("totpURI" in data)) {
    return null;
  }
  return { totpURI: data.totpURI, backupCodes: data.backupCodes };
}

async function verifyCode(code: string): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyTotp({ code });
  return !error;
}

export function SetUpAuthenticatorForm() {
  const router = useRouter();

  function handleFinish(): void {
    router.push(HOME_PATH);
    router.refresh();
  }

  return (
    <AuthenticatorSetup
      enableAuthenticator={enableAuthenticator}
      verifyCode={verifyCode}
      onFinish={handleFinish}
    />
  );
}
