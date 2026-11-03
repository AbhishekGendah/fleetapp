"use client";

import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { QrCode } from "@fleetapp/ui/qr-code";
import { QrCode as QrCodeIcon } from "lucide-react";
import { useActionState } from "react";

import { INITIAL_LINK_SEND_STATE, type LinkSendState } from "../lib/renter-links/link-send-state";

/**
 * A Renter link shown on the Operator's phone as a code for the Renter to
 * scan there and then, e.g. at pickup. The Renter still types the code we
 * email them, and their own details, on their own phone.
 */
export function OnTheSpotLink(props: {
  action: (state: LinkSendState) => Promise<LinkSendState>;
  /** The button, e.g. "Set up on the spot". */
  label: string;
  /** What the Renter does once it opens, in a sentence. */
  instructions: string;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_LINK_SEND_STATE);
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <Button type="submit" variant="outline" disabled={isPending} className="w-full sm:w-auto">
          <QrCodeIcon aria-hidden />
          {isPending ? "Making the code…" : props.label}
        </Button>
      </form>
      {state.status === "failed" ? <FormError message={state.message} /> : null}
      {state.status === "sent" ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-sm">
            Ask the Renter to scan this with their phone&apos;s camera. {props.instructions} It
            works until {state.expiresText}.
          </p>
          <QrCode value={state.url} label="QR code for the Renter's link" />
        </div>
      ) : null}
    </div>
  );
}
