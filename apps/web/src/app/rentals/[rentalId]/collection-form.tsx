"use client";

import {
  DEBIT_COLLECTION_PLAN_LABELS,
  fieldErrorsOf,
  SPLIT_WEEKS_MAX_DIGITS,
  typedDigits,
  type DebitCollectionPlan,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  COLLECTION_FIELDS,
  collectionInputSchema,
  type CollectionField,
} from "../../../lib/debits/debit-plan-input";

/** The weeks are required only for a split. */
function isCollectionRequired(
  field: CollectionField,
  values: Readonly<Record<CollectionField, string>>,
) {
  return field === "collection" || values.collection === "split";
}

/**
 * How a one-off charge is collected when the Renter pays by direct debit
 * (slice 5): the plan, and for a split how many weekly debits (2 to 12,
 * digits only). Shared by the charge form and changing a charge's plan.
 */
export function CollectionFields<Field extends string>(props: {
  fields: FormFields<Field | CollectionField>;
  choices: readonly DebitCollectionPlan[];
}) {
  const { fields } = props;
  return (
    <>
      <FormField
        htmlFor={fields.idFor("collection")}
        label="How to collect it"
        isRequired
        hint="The Renter pays by direct debit. A debit counts as paid once the bank clears it."
        error={fields.errorFor("collection")}
      >
        <Select
          {...fields.boxProps("collection")}
          onChange={(event) => fields.setValue("collection", event.target.value)}
        >
          {props.choices.map((plan) => (
            <option key={plan} value={plan}>
              {DEBIT_COLLECTION_PLAN_LABELS[plan]}
            </option>
          ))}
        </Select>
      </FormField>
      {fields.values.collection === "split" ? (
        <FormField
          htmlFor={fields.idFor("splitWeeks")}
          label="Over how many weekly debits"
          isRequired
          hint="2 to 12. Each week takes an equal part, the odd cents first."
          error={fields.errorFor("splitWeeks")}
        >
          <Input
            {...fields.textBoxProps("splitWeeks")}
            onChange={(event) =>
              fields.setValue("splitWeeks", typedDigits(event.target.value, SPLIT_WEEKS_MAX_DIGITS))
            }
            inputMode="numeric"
          />
        </FormField>
      ) : null}
    </>
  );
}

/** Changes how a one-off charge is collected, until any part of it is debited. */
export function CollectionForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  choices: readonly DebitCollectionPlan[];
  current: { plan: DebitCollectionPlan; weeks: number | null };
}) {
  const form = useChangeForm({
    action: props.action,
    fields: COLLECTION_FIELDS,
    initialValues: {
      collection: props.current.plan,
      splitWeeks: props.current.weeks === null ? "" : String(props.current.weeks),
    },
    validate: (values) => fieldErrorsOf(collectionInputSchema.safeParse(values)),
    isRequired: isCollectionRequired,
  });
  return (
    <ChangeFormShell form={form} submitLabel="Save">
      <CollectionFields fields={form.fields} choices={props.choices} />
    </ChangeFormShell>
  );
}
