import { BRAND } from "@fleetapp/ui/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import type { Metadata } from "next";
import { Suspense } from "react";

import { BackToLink } from "./back-to-link";

/** Never listed by search engines, like every Renter link page. */
export const metadata: Metadata = {
  title: "Back from Stripe",
  robots: { index: false, follow: false },
};

/**
 * Where Stripe's page sends the Renter back to. It holds no secret: this
 * phone remembered the link it came from, and goes back there.
 */
export default function BackFromStripePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Taking you back</CardTitle>
          <CardDescription>
            If nothing happens, open the link in the email you were sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <BackToLink />
          </Suspense>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-center text-xs">Sent using {BRAND.productName}</p>
    </main>
  );
}
