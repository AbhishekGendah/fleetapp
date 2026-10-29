import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { requireSuspendedUser } from "../../lib/require-user";
import { SignOutButton } from "@fleetapp/ui/sign-out-button";
import { SIGN_IN_PATH } from "../../lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where a suspended Operator's signed-in Users land, until it is reactivated. */
export default async function SuspendedPage() {
  await requireSuspendedUser();

  return (
    <AuthPageLayout>
      <Card>
        <CardHeader>
          <CardTitle>This account is suspended</CardTitle>
          <CardDescription>
            Contact us to find out why and to have it reactivated. Your Renters&rsquo; payments are
            not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton signInHref={SIGN_IN_PATH} />
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}
