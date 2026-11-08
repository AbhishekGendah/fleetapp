"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import type { BusinessChoice } from "../../../lib/rentals/driver-choices";
import { nameDriverInputSchema } from "../../../lib/rentals/rental-input";
import { DriverPicker } from "../driver-picker";

const NAME_DRIVER_FIELDS = ["driverId"] as const;

/**
 * Names a business's driver on its draft or booking (mockup 6: "Name a
 * driver"), or puts it back to "to be named". The same picker as the New
 * rental form; the server checks the driver again under the rental's lock.
 */
export function NameDriverForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  businessId: string;
  business: BusinessChoice;
  /** The driver named now, or "to be named". */
  currentValue: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: NAME_DRIVER_FIELDS,
    initialValues: { driverId: props.currentValue },
    validate: (values) => fieldErrorsOf(nameDriverInputSchema.safeParse(values)),
    isRequired: () => false,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save driver">
      <DriverPicker
        id={fields.idFor("driverId")}
        name="driverId"
        businessId={props.businessId}
        business={props.business}
        value={fields.values.driverId}
        onValueChange={(value) => fields.setValue("driverId", value)}
        error={fields.errorFor("driverId")}
        hint="The driver signs for the car at the handover, and has it until it is back."
      />
    </ChangeFormShell>
  );
}
