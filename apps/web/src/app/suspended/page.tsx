import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { SignOutButton } from "../sign-out-button";

/**
 * Where a suspended Operator's signed-in Users land. Deliberately does not
 * call requireUser(), which would send them straight back here.
 */
export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>This account is suspended</CardTitle>
          <CardDescription>
            Contact us to find out why and to have it reactivated. Your Renters&rsquo; payments are
            not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
