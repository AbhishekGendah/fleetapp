"use client";

import { formatCents } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useActionState, useMemo, useState } from "react";

import { completeHandoverAction } from "./actions";
import { useForgetWhenDone } from "./use-forget-when-done";
import { INITIAL_COMPLETE_STATE, SIGNATURE_NEEDED } from "./handover-state";
import { RenterSignatureStep } from "./renter-signature-step";

const REASON_NEEDED = "Say why the car goes before the bond is paid.";

/**
 * The Renter reads what they are accepting and signs with their finger on
 * the Operator's phone (decision 4); possession starts at that moment. When
 * the bond is short, the Operator says why the car goes anyway. Once done,
 * this handover is wiped from the phone.
 */
export function AcceptanceForm(props: {
  rentalId: string;
  inspectionId: string;
  renterName: string;
  summary: string;
  bondShortCents: number | null;
}) {
  const complete = useMemo(
    () => completeHandoverAction.bind(null, props.rentalId, props.inspectionId),
    [props.rentalId, props.inspectionId],
  );
  const [state, formAction, isPending] = useActionState(complete, INITIAL_COMPLETE_STATE);
  const [signature, setSignature] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useForgetWhenDone(state.status === "completed", props);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    const missing =
      signature === ""
        ? SIGNATURE_NEEDED
        : props.bondShortCents !== null && reason.trim() === ""
          ? REASON_NEEDED
          : null;
    setProblem(missing);
    if (missing) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <RequiredFieldsNote />
      <p className="bg-muted rounded-md p-3 text-sm">
        {props.renterName}: by signing, you accept {props.summary}, in the condition shown in this
        checklist. The time is recorded when you sign.
      </p>
      {props.bondShortCents !== null ? (
        <FormField
          htmlFor="bondOverrideReason"
          label={`The bond is ${formatCents(props.bondShortCents)} short. Why does the car go anyway?`}
          isRequired
          hint="Kept with the handover for your records. The Renter does not see it."
        >
          <Input
            id="bondOverrideReason"
            name="bondOverrideReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            required
          />
        </FormField>
      ) : null}
      <RenterSignatureStep
        id="renter-signature"
        renterName={props.renterName}
        onSignatureChange={setSignature}
        problem={problem ?? (state.status === "problem" ? state.message : null)}
        isPending={isPending}
        submitLabel="The Renter accepts the car"
        pendingLabel="Handing over…"
      />
    </form>
  );
}
