"use client";

import {
  centsForEditing,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUSES,
  fieldErrorsOf,
  formatCalendarDate,
  MAXIMUM_NOTE_LENGTH,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";
import { Textarea } from "@fleetapp/ui/textarea";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { ChangeFormShell, useChangeForm } from "../../../../../components/change-form-shell";
import {
  CLAIM_FORM_FIELDS,
  claimFormSchema,
  isRequiredClaimField,
  type ClaimFormField,
  type ClaimFormValues,
} from "../../../../../lib/damage/damage-input";
import { CLAIM_LABELS } from "../../../../../lib/damage/damage-labels";
import type { ClaimPolicyChoice } from "../../../../../lib/damage/damage-queries";

/** One labelled claim box, with its asterisk as the claim gets further. */
function ClaimField(props: {
  fields: FormFields<ClaimFormField>;
  field: ClaimFormField;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <FormField
      htmlFor={props.fields.idFor(props.field)}
      label={CLAIM_LABELS[props.field]}
      isRequired={isRequiredClaimField(props.field, props.fields.values)}
      hint={props.hint}
      error={props.fields.errorFor(props.field)}
    >
      {props.children}
    </FormField>
  );
}

function policyLabel(policy: ClaimPolicyChoice): string {
  return `${policy.insurer} ${policy.policyNumber} (${formatCalendarDate(policy.startsOn)} to ${formatCalendarDate(policy.endsOn)})`;
}

/**
 * The damage's insurance claim, as far as it has gone. It starts from the
 * car's policy on the day the damage was found; choosing another policy
 * fills in its insurer, and its excess if none is typed yet.
 */
export function ClaimForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  initialValues: ClaimFormValues;
  policies: readonly ClaimPolicyChoice[];
  submitLabel: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: CLAIM_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(claimFormSchema.safeParse(values)),
    isRequired: isRequiredClaimField,
    idPrefix: "claim-",
  });
  const { fields } = form;

  function handlePolicyChange(policyId: string): void {
    fields.setValue("policyId", policyId);
    const policy = props.policies.find((choice) => choice.id === policyId);
    if (!policy) {
      return;
    }
    fields.setValue("insurer", policy.insurer);
    if (fields.values.excessCents === "" && policy.excessCents !== null) {
      fields.setValue("excessCents", centsForEditing(policy.excessCents));
    }
  }

  const moneyBox = (field: "excessCents" | "payoutCents") => (
    <MoneyInput
      {...fields.boxProps(field)}
      onValueChange={(value) => fields.setValue(field, value)}
    />
  );

  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      {props.policies.length === 0 ? null : (
        <ClaimField fields={fields} field="policyId">
          <Select
            {...fields.boxProps("policyId")}
            onChange={(event) => handlePolicyChange(event.target.value)}
          >
            <option value="">No policy</option>
            {props.policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policyLabel(policy)}
              </option>
            ))}
          </Select>
        </ClaimField>
      )}
      <ClaimField fields={fields} field="insurer">
        <Input {...fields.textBoxProps("insurer")} placeholder="e.g. Example Insurance" />
      </ClaimField>
      <ClaimField fields={fields} field="status">
        <Select
          {...fields.boxProps("status")}
          onChange={(event) => fields.setValue("status", event.target.value)}
        >
          {CLAIM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CLAIM_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </ClaimField>
      <ClaimField fields={fields} field="claimNumber">
        <Input
          {...fields.textBoxProps("claimNumber")}
          onChange={(event) => fields.setValue("claimNumber", event.target.value.toUpperCase())}
          autoCapitalize="characters"
        />
      </ClaimField>
      <div className="grid grid-cols-2 gap-4">
        <ClaimField fields={fields} field="lodgedOn">
          <Input {...fields.textBoxProps("lodgedOn")} type="date" />
        </ClaimField>
        <ClaimField fields={fields} field="settledOn">
          <Input {...fields.textBoxProps("settledOn")} type="date" />
        </ClaimField>
        <ClaimField fields={fields} field="excessCents">
          {moneyBox("excessCents")}
        </ClaimField>
        <ClaimField fields={fields} field="payoutCents">
          {moneyBox("payoutCents")}
        </ClaimField>
      </div>
      <ClaimField fields={fields} field="notes" hint="For you only.">
        <Textarea
          {...fields.boxProps("notes")}
          onChange={(event) => fields.setValue("notes", event.target.value)}
          maxLength={MAXIMUM_NOTE_LENGTH}
          rows={3}
        />
      </ClaimField>
    </ChangeFormShell>
  );
}
