import { formatCents } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { standInPayments } from "../../../../lib/payments/app-payments";
import { finishStandInCheckoutAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Stand-in for Stripe",
  robots: { index: false, follow: false },
};

/**
 * Browser tests only (PAYMENTS_TRANSPORT=stand_in, refused in production):
 * stands in for Stripe's own page, where the Renter would type their bank
 * or card details. Nothing is typed here.
 */
export default async function StandInCheckoutPage(props: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await props.params;
  const checkout = standInPayments()?.checkout(sessionId);
  if (!checkout) {
    notFound();
  }
  const { payment } = checkout.request;
  const finish = (method: Parameters<typeof finishStandInCheckoutAction>[1]) =>
    finishStandInCheckoutAction.bind(null, sessionId, method);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Stand-in for Stripe</CardTitle>
          <CardDescription>
            {payment
              ? `${payment.description}: ${formatCents(payment.amountCents)}`
              : "Set up a BECS direct debit"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {checkout.outcome.isComplete || checkout.outcome.isExpired ? (
            <p role="status" className="text-sm">
              {checkout.outcome.isComplete
                ? "This page has already been paid."
                : "This page has expired."}
            </p>
          ) : payment ? (
            <>
              <form action={finish("card")}>
                <Button type="submit" className="w-full">
                  Pay by card
                </Button>
              </form>
              <form action={finish("becs_debit")}>
                <Button type="submit" variant="outline" className="w-full">
                  Pay from my bank account
                </Button>
              </form>
            </>
          ) : (
            <form action={finish("becs_debit")}>
              <Button type="submit" className="w-full">
                Accept and set up
              </Button>
            </form>
          )}
          <form action={finish("leave")}>
            <Button type="submit" variant="outline" className="w-full">
              Go back without finishing
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
