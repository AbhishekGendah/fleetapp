import { describeErrorForLog } from "@fleetapp/core";
import { NextResponse, type NextRequest } from "next/server";

import { appDb } from "../../../../lib/app-db";
import { appPayments } from "../../../../lib/payments/app-payments";
import { handlePaymentEvent } from "../../../../lib/payments/payment-accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;
const FAILED_STATUS = 500;
/** Stripe sends any answer that is not a success again later, with a growing wait. */
const NOT_READY_STATUS = 503;
const SIGNATURE_HEADER = "stripe-signature";

/**
 * Stripe's events (one endpoint, rule 20). The body is read as sent, so its
 * signature can be checked; a failure answers 500 and Stripe sends it again.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!appPayments) {
    return NextResponse.json({ error: "not_set_up" }, { status: NOT_FOUND_STATUS });
  }
  const signature = request.headers.get(SIGNATURE_HEADER);
  if (!signature) {
    return NextResponse.json({ error: "unsigned" }, { status: BAD_REQUEST_STATUS });
  }
  try {
    const result = await handlePaymentEvent(
      { database: appDb, payments: appPayments, now: () => new Date() },
      await request.text(),
      signature,
    );
    if (result === "refused") {
      return NextResponse.json({ error: "bad_signature" }, { status: BAD_REQUEST_STATUS });
    }
    return result === "not_ready"
      ? NextResponse.json({ error: "not_ready" }, { status: NOT_READY_STATUS })
      : NextResponse.json({ received: result });
  } catch (error) {
    console.error("Handling a Stripe event failed", describeErrorForLog(error));
    return NextResponse.json({ error: "failed" }, { status: FAILED_STATUS });
  }
}
