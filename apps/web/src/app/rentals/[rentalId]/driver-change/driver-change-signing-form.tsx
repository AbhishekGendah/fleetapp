"use client";

import { AT_SIGNING_WORDS, type BusinessAcceptance } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormSection } from "@fleetapp/ui/form-section";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { CheckCircle2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import type { ShownChecklist } from "../../../../lib/handover/checklist-fingerprint";
import type { ShownDriverChange } from "../../../../lib/handover/complete-driver-change";
import {
  INCOMING_PREFIX,
  OUTGOING_PREFIX,
  OUTGOING_PRESENT,
} from "../../../../lib/rentals/driver-change-input";
import { AcceptanceSummary } from "../handover/acceptance-summary";
import {
  NO_SIGNATURE,
  RenterSignatureFields,
  signatureProblemOf,
} from "../handover/renter-signature-step";
import { useForgetWhenDone } from "../handover/use-forget-when-done";
import { completeDriverChangeAction } from "./actions";
import { INITIAL_DRIVER_CHANGE_STATE } from "./driver-change-state";

/** One of the two drivers who sign: their name, and the business they have the car for. */
export interface SigningDriver {
  name: string;
  forBusiness?: BusinessAcceptance;
}

/**
 * A driver change's last step (mockup 7): the driver handing the car back
 * signs the check-in (or is recorded as not there, as at a return), then
 * the new driver signs for the car. Both are sent together, with what the
 * page showed, so nothing is signed for a check-in or a driver that changed
 * meanwhile. Nothing drawn is kept on the phone between pages.
 */
export function DriverChangeSigningForm(props: {
  rentalId: string;
  returnInspectionId: string;
  handoverInspectionId: string;
  shown: ShownDriverChange;
  car: string;
  checkIn: ShownChecklist;
  outgoing: SigningDriver;
  incoming: SigningDriver;
  /** The rental's rules ask for a signature at a return: "not here" is not offered. */
  isOutgoingSignatureRequired: boolean;
  privacyLine: React.ReactNode;
}) {
  const complete = useMemo(
    () => completeDriverChangeAction.bind(null, props.rentalId),
    [props.rentalId],
  );
  const [state, formAction, isPending] = useActionState(complete, INITIAL_DRIVER_CHANGE_STATE);
  const [isOutgoingTicked, setIsOutgoingTicked] = useState(true);
  const isOutgoingPresent = props.isOutgoingSignatureRequired || isOutgoingTicked;
  const [outgoingSignature, setOutgoingSignature] = useState(NO_SIGNATURE);
  const [incomingSignature, setIncomingSignature] = useState(NO_SIGNATURE);
  const [problem, setProblem] = useState<string | null>(null);

  useForgetWhenDone(state.status === "completed", {
    rentalId: props.rentalId,
    inspectionId: props.returnInspectionId,
    otherInspectionId: props.handoverInspectionId,
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    const missing =
      (isOutgoingPresent ? signatureProblemOf(outgoingSignature, props.outgoing.name) : null) ??
      signatureProblemOf(incomingSignature, props.incoming.name);
    setProblem(missing);
    if (missing) {
      event.preventDefault();
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <RequiredFieldsNote />
      <FormSection title={`${props.outgoing.name} signs`}>
        {props.isOutgoingSignatureRequired ? (
          <input type="hidden" name="isOutgoingPresent" value={OUTGOING_PRESENT} />
        ) : (
          <Checkbox
            name="isOutgoingPresent"
            value={OUTGOING_PRESENT}
            checked={isOutgoingPresent}
            onChange={(event) => setIsOutgoingTicked(event.target.checked)}
            label={`${props.outgoing.name} is here to sign`}
          />
        )}
        {isOutgoingPresent ? (
          <>
            <p className="text-sm">
              {props.outgoing.name}: by signing, you hand this car back and say:
            </p>
            <AcceptanceSummary
              car={props.car}
              verb="returned"
              atText={AT_SIGNING_WORDS}
              shown={props.checkIn}
              forBusiness={props.outgoing.forBusiness}
            />
            <RenterSignatureFields
              id="outgoing-signature"
              namePrefix={OUTGOING_PREFIX}
              renterName={props.outgoing.name}
              onSignatureChange={setOutgoingSignature}
              privacyLine={props.privacyLine}
            />
          </>
        ) : (
          <p className="bg-muted rounded-md p-3 text-sm">
            The check-in report will say {props.outgoing.name} was not here, and that you recorded
            the car as returned.
          </p>
        )}
      </FormSection>
      <FormSection title={`${props.incoming.name} signs for the car`}>
        <p className="text-sm">{props.incoming.name}: by signing, you take this car and say:</p>
        <AcceptanceSummary
          car={props.car}
          verb="received"
          atText={AT_SIGNING_WORDS}
          shown={props.checkIn}
          forBusiness={props.incoming.forBusiness}
        />
        <RenterSignatureFields
          id="incoming-signature"
          namePrefix={INCOMING_PREFIX}
          renterName={props.incoming.name}
          onSignatureChange={setIncomingSignature}
          privacyLine={props.privacyLine}
        />
      </FormSection>
      {(Object.keys(props.shown) as (keyof ShownDriverChange)[]).map((name) => (
        <input key={name} type="hidden" name={name} value={props.shown[name]} />
      ))}
      <p className="bg-muted rounded-md p-3 text-sm">
        When {props.incoming.name} signs, {props.outgoing.name}&apos;s time with the car ends and{" "}
        {props.incoming.name}&apos;s starts, both at that moment. The rent, bond and contract stay
        as they are.
      </p>
      <FormError
        message={problem ?? (state.status === "problem" && !isPending ? state.message : null)}
      />
      <Button type="submit" disabled={isPending} className="w-full">
        <CheckCircle2 aria-hidden />
        {isPending ? "Finishing…" : "Finish driver change"}
      </Button>
    </form>
  );
}
