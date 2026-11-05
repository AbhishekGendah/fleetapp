"use client";

import { AT_SIGNING_WORDS } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useActionState, useMemo, useState } from "react";

import type { ShownChecklist } from "../../../../lib/handover/checklist-fingerprint";
import type {
  OverridableProblemCode,
  OverrideReasonField,
} from "../../../../lib/handover/override-reasons";
import { AcceptanceSummary } from "./acceptance-summary";
import { completeHandoverAction } from "./actions";
import { useForgetWhenDone } from "./use-forget-when-done";
import { INITIAL_COMPLETE_STATE } from "./handover-state";
import { NO_SIGNATURE, RenterSignatureStep, signatureProblemOf } from "./renter-signature-step";

const REASON_MAX_LENGTH = 200;

/** A check the business can let the car go without, given a reason (review A8-2). */
export interface OverrideAsked {
  code: OverridableProblemCode;
  name: OverrideReasonField;
  label: string;
  neededMessage: string;
}

/** Why the car goes anyway: kept with the handover, never shown to the Renter. */
function OverrideReason(props: {
  name: OverrideReasonField;
  label: string;
  value: string;
  problem: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      htmlFor={props.name}
      label={props.label}
      isRequired
      error={props.problem ?? undefined}
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
  /** Where the business's privacy policy is, shown before the Renter signs. */
  privacyLine: React.ReactNode;
  summary: string;
  shown: ShownChecklist;
  overrides: readonly OverrideAsked[];
}) {
  const complete = useMemo(
    () => completeHandoverAction.bind(null, props.rentalId, props.inspectionId),
    [props.rentalId, props.inspectionId],
  );
  const [state, formAction, isPending] = useActionState(complete, INITIAL_COMPLETE_STATE);
  const [signature, setSignature] = useState(NO_SIGNATURE);
  const [reasons, setReasons] = useState<Partial<Record<OverrideReasonField, string>>>({});
  const [missingReasons, setMissingReasons] = useState<ReadonlySet<OverrideReasonField>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);

  useForgetWhenDone(state.status === "completed", props);

  function handleReasonChange(name: OverrideReasonField, value: string): void {
    setReasons((current) => ({ ...current, [name]: value }));
    if (value.trim() !== "") {
      setMissingReasons((current) => new Set([...current].filter((field) => field !== name)));
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    // Each missing reason is said under its own box (review A10-10).
    const missing = props.overrides
      .filter((override) => (reasons[override.name] ?? "").trim() === "")
      .map((override) => override.name);
    const signatureProblem = signatureProblemOf(signature, props.renterName);
    setMissingReasons(new Set(missing));
    setProblem(signatureProblem);
    if (missing.length > 0 || signatureProblem) {
      event.preventDefault();
      if (missing[0]) {
        document.getElementById(missing[0])?.focus();
      }
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <RequiredFieldsNote />
      <p className="text-sm">{props.renterName}: by signing, you accept this car and say:</p>
      <AcceptanceSummary
        car={props.summary}
        verb="received"
        atText={AT_SIGNING_WORDS}
        shown={props.shown}
      />
      <input type="hidden" name="checklistFingerprint" value={props.shown.fingerprint} />
      {props.overrides.map((override) => (
        <OverrideReason
          key={override.code}
          name={override.name}
          label={override.label}
          value={reasons[override.name] ?? ""}
          problem={missingReasons.has(override.name) ? override.neededMessage : null}
          onChange={(value) => handleReasonChange(override.name, value)}
        />
      ))}
      <RenterSignatureStep
        id="renter-signature"
        renterName={props.renterName}
        onSignatureChange={setSignature}
        privacyLine={props.privacyLine}
        problem={problem ?? (state.status === "problem" ? state.message : null)}
        isPending={isPending}
        submitLabel="The Renter accepts the car"
        pendingLabel="Handing over…"
      />
    </form>
  );
}
