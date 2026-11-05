"use client";

import { fieldErrorsOf, STATUSES_AFTER_SWAP } from "@fleetapp/core";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState, useMemo, useState } from "react";

import {
  FINISH_SWAP_FIELDS,
  finishSwapFormSchema,
  INITIAL_FINISH_SWAP_VALUES,
} from "../../../../lib/rentals/swap-input";
import { CarStatusFields } from "../../../cars/[vehicleId]/car-status-fields";
import {
  NO_SIGNATURE,
  RenterSignatureStep,
  signatureProblemOf,
} from "../handover/renter-signature-step";
import { useForgetWhenDone } from "../handover/use-forget-when-done";
import type { ShownSwap } from "../../../../lib/handover/complete-swap";
import { completeSwapAction } from "./swap-actions";
import { INITIAL_SWAP_STATE } from "./swap-state";

const isRequiredField = (field: string, values: Readonly<Record<string, string>>): boolean =>
  field === "status" || values.status !== "available";

/**
 * The swap's last step: where the car handed back goes, then the Renter
 * reads what they accept and signs on the phone. Possession moves to the
 * new car at that moment. Once done, both checklists are wiped from the phone.
 */
export function SwapForm(props: {
  rentalId: string;
  returnInspectionId: string;
  handoverInspectionId: string;
  renterName: string;
  oldCar: string;
  shown: ShownSwap;
}) {
  const complete = useMemo(() => completeSwapAction.bind(null, props.rentalId), [props.rentalId]);
  const [state, formAction, isPending] = useActionState(complete, INITIAL_SWAP_STATE);
  const form = useFormFields({
    fields: FINISH_SWAP_FIELDS,
    initialValues: INITIAL_FINISH_SWAP_VALUES,
    validate: (values) => fieldErrorsOf(finishSwapFormSchema.safeParse(values)),
    isRequired: isRequiredField,
    idPrefix: "swap-",
  });
  const [signature, setSignature] = useState(NO_SIGNATURE);
  const [problem, setProblem] = useState<string | null>(null);

  useForgetWhenDone(state.status === "completed", {
    rentalId: props.rentalId,
    inspectionId: props.handoverInspectionId,
    otherInspectionId: props.returnInspectionId,
  });

  const submit = form.submitHandler(formAction);
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    const missing = signatureProblemOf(signature, props.renterName);
    setProblem(missing);
    if (missing) {
      event.preventDefault();
      return;
    }
    submit(event);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <RequiredFieldsNote />
      <CarStatusFields
        form={form}
        statuses={STATUSES_AFTER_SWAP}
        label={`Where does ${props.oldCar} go now?`}
      />
      {(Object.keys(props.shown) as (keyof ShownSwap)[]).map((name) => (
        <input key={name} type="hidden" name={name} value={props.shown[name]} />
      ))}
      <RenterSignatureStep
        id="swap-signature"
        renterName={props.renterName}
        onSignatureChange={setSignature}
        problem={problem ?? (state.status === "problem" ? state.message : null)}
        isPending={isPending}
        submitLabel="The Renter signs the swap"
        pendingLabel="Swapping…"
      />
    </form>
  );
}
