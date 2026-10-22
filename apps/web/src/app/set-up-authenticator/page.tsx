import { redirect } from "next/navigation";

import { requireUser } from "../../lib/require-user";
import { SetUpAuthenticatorForm } from "./set-up-authenticator-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SetUpAuthenticatorPage() {
  const user = await requireUser({ allowWithoutAuthenticator: true });

  // Nobody re-enrols by visiting this page. Replacing an authenticator goes
  // through AGS, after checking who is asking.
  if (user.twoFactorEnabled) {
    redirect("/");
  }

  return <SetUpAuthenticatorForm />;
}
