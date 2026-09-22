import { redirect } from "next/navigation";

import { requireAdmin } from "../../lib/require-admin";
import { SetUpAuthenticatorForm } from "./set-up-authenticator-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SetUpAuthenticatorPage() {
  const admin = await requireAdmin({ allowWithoutAuthenticator: true });

  // Nobody re-enrols by visiting this page. Replacing an authenticator is a
  // deliberate act that goes through an Admin who is already trusted.
  if (admin.twoFactorEnabled) {
    redirect("/");
  }

  return <SetUpAuthenticatorForm />;
}
