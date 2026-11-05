"use client";

import {
  readRenterSignature,
  SIGNATURE_METHOD_CHOICES,
  type RenterSignatureInput,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { SignaturePad } from "@fleetapp/ui/signature-pad";
import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { SIGNATURE_NEEDED, TYPED_NAME_NEEDED } from "./handover-state";

export const NO_SIGNATURE: RenterSignatureInput = {
  method: "drawn",
  typedName: "",
  drawnSignature: "",
};

/** What is missing from the Renter's signature, or null once it will be accepted. */
export function signatureProblemOf(
  signature: RenterSignatureInput,
  renterName: string,
): string | null {
  if (readRenterSignature(signature, renterName)) {
    return null;
  }
  return signature.method === "typed" ? TYPED_NAME_NEEDED : SIGNATURE_NEEDED;
}

/**
 * The Renter's signature on the Operator's phone: drawn, or their full name
 * typed, as on their own signing link (review G9-10, WCAG 2.1.1).
 */
export function RenterSignatureFields(props: {
  id: string;
  renterName: string;
  onSignatureChange: (signature: RenterSignatureInput) => void;
}) {
  const [signature, setSignature] = useState<RenterSignatureInput>(NO_SIGNATURE);
  const methodId = `${props.id}-method`;

  function change(next: Partial<RenterSignatureInput>): void {
    const updated = { ...signature, ...next };
    setSignature(updated);
    props.onSignatureChange(updated);
  }

  return (
    <>
      <FormField htmlFor={methodId} label={`How ${props.renterName} signs`} isRequired>
        <Select
          id={methodId}
          name="method"
          required
          value={signature.method}
          // A new way of signing starts afresh: the box that comes back is empty.
          onChange={(event) => change({ ...NO_SIGNATURE, method: event.target.value })}
        >
          {SIGNATURE_METHOD_CHOICES.map((choice) => (
            <option key={choice.method} value={choice.method}>
              {choice.label}
            </option>
          ))}
        </Select>
      </FormField>
      {signature.method === "typed" ? (
        <FormField
          htmlFor={props.id}
          label={`${props.renterName}'s full name`}
          isRequired
          hint={`Exactly as: ${props.renterName}`}
        >
          <Input
            id={props.id}
            name="typedName"
            required
            autoComplete="off"
            value={signature.typedName}
            onChange={(event) => change({ typedName: event.target.value })}
          />
        </FormField>
      ) : (
        <FormField htmlFor={props.id} label={`${props.renterName}'s signature`} isRequired>
          <SignaturePad
            id={props.id}
            name="drawnSignature"
            onValueChange={(drawnSignature) => change({ drawnSignature })}
          />
        </FormField>
      )}
    </>
  );
}

/**
 * The end of a form the Renter signs on the Operator's phone (a handover or
 * a swap): their signature, what went wrong, and the button.
 */
export function RenterSignatureStep(props: {
  id: string;
  renterName: string;
  onSignatureChange: (signature: RenterSignatureInput) => void;
  problem: string | null;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
}) {
  return (
    <>
      <RenterSignatureFields
        id={props.id}
        renterName={props.renterName}
        onSignatureChange={props.onSignatureChange}
      />
      <FormError message={props.isPending ? null : props.problem} />
      <Button type="submit" disabled={props.isPending} className="w-full">
        <CheckCircle2 aria-hidden />
        {props.isPending ? props.pendingLabel : props.submitLabel}
      </Button>
    </>
  );
}
