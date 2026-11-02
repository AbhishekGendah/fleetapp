"use client";

import { needsReturnDate, VEHICLE_STATUS_LABELS, type OperatorVehicleStatus } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { VEHICLE_FIELD_LABELS } from "../../../lib/vehicles/vehicle-labels";

type StatusField = "status" | "statusReason" | "statusExpectedBack";

/**
 * A car's status boxes: the status, and for In service or Off road why and
 * until when. On the car's status form and at the end of a return.
 */
export function CarStatusFields<Field extends string>(props: {
  form: FormFields<Field | StatusField>;
  statuses: readonly OperatorVehicleStatus[];
  label?: string;
}) {
  const { form } = props;
  return (
    <>
      <FormField
        htmlFor={form.idFor("status")}
        label={props.label ?? VEHICLE_FIELD_LABELS.status}
        isRequired
      >
        <Select
          {...form.boxProps("status")}
          onChange={(event) => form.setValue("status", event.target.value)}
        >
          {props.statuses.map((status) => (
            <option key={status} value={status}>
              {VEHICLE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </FormField>
      {needsReturnDate(form.values.status) ? (
        <>
          <FormField
            htmlFor={form.idFor("statusReason")}
            label={VEHICLE_FIELD_LABELS.statusReason}
            isRequired
            error={form.errorFor("statusReason")}
          >
            <Input {...form.textBoxProps("statusReason")} placeholder="e.g. Brakes and tyres" />
          </FormField>
          <FormField
            htmlFor={form.idFor("statusExpectedBack")}
            label={VEHICLE_FIELD_LABELS.statusExpectedBack}
            isRequired
            error={form.errorFor("statusExpectedBack")}
          >
            <Input {...form.textBoxProps("statusExpectedBack")} type="date" />
          </FormField>
        </>
      ) : null}
    </>
  );
}
