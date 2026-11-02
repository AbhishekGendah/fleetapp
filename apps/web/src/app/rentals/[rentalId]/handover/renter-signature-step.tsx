"use client";

import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { SignaturePad } from "@fleetapp/ui/signature-pad";
import { CheckCircle2 } from "lucide-react";

/**
 * The end of a form the Renter signs on the Operator's phone (a handover or
 * a swap): their signature box, what went wrong, and the button.
 */
export function RenterSignatureStep(props: {
  id: string;
  renterName: string;
  onSignatureChange: (signature: string) => void;
  problem: string | null;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <>
      <FormField htmlFor={props.id} label={`${props.renterName}'s signature`} isRequired>
        <SignaturePad id={props.id} name="drawnSignature" onValueChange={props.onSignatureChange} />
      </FormField>
      <FormError message={props.isPending ? null : props.problem} />
      <Button type="submit" disabled={props.isPending} className="w-full">
        <CheckCircle2 aria-hidden />
        {props.isPending ? props.pendingLabel : props.submitLabel}
      </Button>
    </>
  );
}
