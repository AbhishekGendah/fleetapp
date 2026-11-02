"use client";

import {
  DAMAGE_STATUS_LABELS,
  DAMAGE_STATUSES,
  fieldErrorsOf,
  needsDamageNote,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Select } from "@fleetapp/ui/select";
import { Input } from "@fleetapp/ui/input";

import { ChangeFormShell, useChangeForm } from "../../../../../components/change-form-shell";
import {
  DAMAGE_STATUS_FIELDS,
  damageStatusFormSchema,
} from "../../../../../lib/damage/damage-input";
import { DAMAGE_STATUS_FIELD_LABELS } from "../../../../../lib/damage/damage-labels";

const isNoteNeeded = (value: string): boolean =>
  DAMAGE_STATUSES.some((status) => status === value && needsDamageNote(status));

type StatusValues = Record<(typeof DAMAGE_STATUS_FIELDS)[number], string>;

/** Open, Repaired, or Not repairing with the reason. */
export function DamageStatusForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  initialValues: StatusValues;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: DAMAGE_STATUS_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(damageStatusFormSchema.safeParse(values)),
    isRequired: (field, values) => field === "status" || isNoteNeeded(values.status),
  });
  const { fields } = form;
  const isNoteRequired = isNoteNeeded(fields.values.status);
  return (
    <ChangeFormShell form={form} submitLabel="Save status">
      <FormField
        htmlFor={fields.idFor("status")}
        label={DAMAGE_STATUS_FIELD_LABELS.status}
        isRequired
      >
        <Select
          {...fields.boxProps("status")}
          onChange={(event) => fields.setValue("status", event.target.value)}
        >
          {DAMAGE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {DAMAGE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={fields.idFor("statusNote")}
        label={DAMAGE_STATUS_FIELD_LABELS.statusNote}
        isRequired={isNoteRequired}
        hint={isNoteRequired ? "Why it is not being repaired, e.g. cosmetic only." : undefined}
        error={fields.errorFor("statusNote")}
      >
        <Input {...fields.textBoxProps("statusNote")} />
      </FormField>
    </ChangeFormShell>
  );
}
