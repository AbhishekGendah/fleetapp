"use client";

import { formatCents } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useActionState, useMemo, useState } from "react";

import { completeHandoverAction } from "./actions";
import { useForgetWhenDone } from "./use-forget-when-done";
import { INITIAL_COMPLETE_STATE } from "./handover-state";
import { NO_SIGNATURE, RenterSignatureStep, signatureProblemOf } from "./renter-signature-step";

const BOND_REASON_NEEDED = "Say why the car goes before the bond is paid.";
const DIRECT_DEBIT_REASON_NEEDED = "Say why the car goes without a direct debit set up.";
const REASON_MAX_LENGTH = 200;

/** Why the car goes anyway: kept with the handover, never shown to the Renter. */
function OverrideReason(props: {
  name: "bondOverrideReason" | "directDebitOverrideReason";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      htmlFor={props.name}
      label={props.label}
      isRequired
      hint="Kept with the handover for your records. The Renter does not see it."
    >
      <Input
        id={props.name}
        name={props.name}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={REASON_MAX_LENGTH}
        required
      />
    </FormField>
  );
}

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
  isDirectDebitMissing: boolean;
}) {
  const complete = useMemo(
    () => completeHandoverAction.bind(null, props.rentalId, props.inspectionId),
    [props.rentalId, props.inspectionId],
  );
  const [state, formAction, isPending] = useActionState(complete, INITIAL_COMPLETE_STATE);
  const [signature, setSignature] = useState(NO_SIGNATURE);
  const [reason, setReason] = useState("");
  const [directDebitReason, setDirectDebitReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useForgetWhenDone(state.status === "completed", props);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    const missing =
      [
        signatureProblemOf(signature, props.renterName),
        props.bondShortCents !== null && reason.trim() === "" ? BOND_REASON_NEEDED : null,
        props.isDirectDebitMissing && directDebitReason.trim() === ""
          ? DIRECT_DEBIT_REASON_NEEDED
          : null,
      ].find((message) => message !== null) ?? null;
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
        <OverrideReason
          name="bondOverrideReason"
          label={`The bond is ${formatCents(props.bondShortCents)} short. Why does the car go anyway?`}
          value={reason}
          onChange={setReason}
        />
      ) : null}
      {props.isDirectDebitMissing ? (
        <OverrideReason
          name="directDebitOverrideReason"
          label="The Renter's direct debit is not set up. Why does the car go anyway?"
          value={directDebitReason}
          onChange={setDirectDebitReason}
        />
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
