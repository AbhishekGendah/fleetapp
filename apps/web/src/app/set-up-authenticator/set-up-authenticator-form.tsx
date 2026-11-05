"use client";

import { enableAuthenticator, isSetUpCodeRight } from "@fleetapp/auth/client";
import { AuthenticatorSetup } from "@fleetapp/ui/authenticator-setup";
import { useRouter } from "next/navigation";

import { HOME_PATH } from "../../lib/paths";

export function SetUpAuthenticatorForm() {
  const router = useRouter();

  function handleFinish(): void {
    router.push(HOME_PATH);
    router.refresh();
  }

  return (
    <AuthenticatorSetup
      enableAuthenticator={enableAuthenticator}
      verifyCode={isSetUpCodeRight}
      onFinish={handleFinish}
    />
  );
}
