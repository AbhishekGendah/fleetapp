import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HOME_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { SetUpAuthenticatorForm } from "./set-up-authenticator-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Set up your authenticator" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SetUpAuthenticatorPage() {
  const user = await requireUser({ allowWithoutAuthenticator: true });

  // Nobody re-enrols by visiting this page. Replacing an authenticator goes
  // through AGS, after checking who is asking.
  if (user.twoFactorEnabled) {
    redirect(HOME_PATH);
  }

  return <SetUpAuthenticatorForm />;
}
