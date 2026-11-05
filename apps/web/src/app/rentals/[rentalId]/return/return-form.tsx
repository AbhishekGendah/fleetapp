"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { DateTimePicker } from "@fleetapp/ui/date-time-picker";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { CheckCircle2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import {
  isRequiredReturnField,
  RETURN_FORM_FIELDS,
  returnFormSchema,
  STATUSES_AFTER_RETURN,
  TICKED,
  type ReturnFormValues,
} from "../../../../lib/handover/return-input";
import { CarStatusFields } from "../../../cars/[vehicleId]/car-status-fields";
import {
  NO_SIGNATURE,
  RenterSignatureFields,
  signatureProblemOf,
} from "../handover/renter-signature-step";
import { useForgetWhenDone } from "../handover/use-forget-when-done";
import { completeReturnAction } from "./actions";
import { INITIAL_RETURN_STATE } from "./return-state";

/**
 * The return's last step: when the car came back (now, or the real time of
 * an after-hours drop-off), the Renter's signature if they are there, and
 * where the car goes next. Once finished, the return is wiped from the phone.
 */
export function ReturnForm(props: {
  rentalId: string;
  inspectionId: string;
  renterName: string;
  summary: string;
  timeZone: string;
  initialValues: ReturnFormValues;
  /** The rental's settings want the Renter's signature: "not here" is not offered. */
  isSignatureRequired: boolean;
}) {
  const complete = useMemo(
    () => completeReturnAction.bind(null, props.rentalId, props.inspectionId),
    [props.rentalId, props.inspectionId],
  );
  const [state, formAction, isPending] = useActionState(complete, INITIAL_RETURN_STATE);
  const schema = useMemo(() => returnFormSchema(props.timeZone), [props.timeZone]);
  const form = useFormFields({
    fields: RETURN_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(schema.safeParse(values)),
    isRequired: isRequiredReturnField,
    idPrefix: "return-",
  });
  const [signature, setSignature] = useState(NO_SIGNATURE);
  const [problem, setProblem] = useState<string | null>(null);
  const isRenterPresent = props.isSignatureRequired || form.values.isRenterPresent === TICKED;

  useForgetWhenDone(state.status === "completed", props);

  const submit = form.submitHandler(formAction);
  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    const missing = isRenterPresent ? signatureProblemOf(signature, props.renterName) : null;
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
      <FormField
        htmlFor={form.idFor("returnedAt")}
        label="Returned"
        isRequired
        hint="Now, unless the car was dropped off earlier: then enter when it really came back."
        error={form.errorFor("returnedAt")}
      >
        <DateTimePicker
          {...form.boxProps("returnedAt")}
          onValueChange={(value) => form.setValue("returnedAt", value)}
        />
      </FormField>
      <CarStatusFields
        form={form}
        statuses={STATUSES_AFTER_RETURN}
        label="Where does the car go now?"
      />
      {props.isSignatureRequired ? (
        <input type="hidden" name="isRenterPresent" value={TICKED} />
      ) : (
        <Checkbox
          name="isRenterPresent"
          checked={isRenterPresent}
          onChange={(event) => form.setValue("isRenterPresent", event.target.checked ? TICKED : "")}
          label={`${props.renterName} is here to sign`}
        />
      )}
      {isRenterPresent ? (
        <>
          <p className="bg-muted rounded-md p-3 text-sm">
            {props.renterName}: by signing, you agree you returned {props.summary} at the time
            above, in the condition shown in this checklist.
          </p>
          <RenterSignatureFields
            id="renter-signature"
            renterName={props.renterName}
            onSignatureChange={setSignature}
          />
        </>
      ) : (
        <p className="bg-muted rounded-md p-3 text-sm">
          The report will say the Renter was not here, and that you recorded the return.
        </p>
      )}
      <FormError
        message={problem ?? (state.status === "problem" && !isPending ? state.message : null)}
      />
      <Button type="submit" disabled={isPending} className="w-full">
        <CheckCircle2 aria-hidden />
        {isPending ? "Finishing…" : "Finish return"}
      </Button>
    </form>
  );
}
