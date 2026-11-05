import type { Metadata } from "next";
import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { requireSuspendedUser } from "../../lib/require-user";
import { PhoneSignOutButton } from "../../components/phone-sign-out-button";
import { PhoneWeekLimit } from "../../components/phone-week-limit";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Account paused" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where a suspended Operator's signed-in Users land, until it is reactivated. */
export default async function SuspendedPage() {
  await requireSuspendedUser();

  return (
    <AuthPageLayout>
      {/* A suspended business never reaches the app's pages, so the phone's week limit runs here too. */}
      <PhoneWeekLimit />
      <Card>
        <CardHeader>
          <CardTitle>This account is suspended</CardTitle>
          <CardDescription>
            Contact us to find out why and to have it reactivated. Your Renters&rsquo; payments are
            not affected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhoneSignOutButton />
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}
