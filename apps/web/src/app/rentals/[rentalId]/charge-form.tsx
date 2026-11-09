"use client";

import { fieldErrorsOf, type DebitCollectionPlan } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { CollectionFields } from "./collection-form";
import {
  chargeWithCollectionSchema,
  COLLECTION_FIELDS,
  type CollectionField,
} from "../../../lib/debits/debit-plan-input";
import { CHARGE_FIELDS, type ChargeField } from "../../../lib/ledger/ledger-input";

const FIELDS = [...CHARGE_FIELDS, ...COLLECTION_FIELDS] as const;
type Field = ChargeField | CollectionField;

/** Every box is required, but the weeks only for a split. */
function isRequired(field: Field, values: Readonly<Record<Field, string>>): boolean {
  return field === "splitWeeks"
    ? values.collection === "split"
    : field !== "collection" || values.collection !== "";
}

/**
 * A one-off charge: what for (its type sets the GST), how much, what the
 * Renter reads, the day, and, for a Renter paying by direct debit, how it
 * is collected.
 */
export function ChargeForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  chargeTypes: readonly { id: string; label: string }[];
  initialValues: Record<ChargeField, string>;
  /** The ways it can be collected; none when the Renter has no working direct debit. */
  collectionChoices: readonly DebitCollectionPlan[];
  /** The rental's default (its settings copy, rule 14), if it is one of the choices. */
  defaultCollection: DebitCollectionPlan;
}) {
  const { collectionChoices } = props;
  const firstChoice = collectionChoices.includes(props.defaultCollection)
    ? props.defaultCollection
    : (collectionChoices[0] ?? "");
  const form = useChangeForm<Field>({
    action: props.action,
    fields: FIELDS,
    initialValues: { ...props.initialValues, collection: firstChoice, splitWeeks: "" },
    validate: (values) => fieldErrorsOf(chargeWithCollectionSchema.safeParse(values)),
    isRequired,
    shouldClearOnSave: true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Add charge">
      <FormField
        htmlFor={fields.idFor("chargeTypeId")}
        label="What for"
        isRequired
        hint="Its GST is set in Settings → Charges."
        error={fields.errorFor("chargeTypeId")}
      >
        <Select
          {...fields.boxProps("chargeTypeId")}
          onChange={(event) => fields.setValue("chargeTypeId", event.target.value)}
        >
          <option value="">Choose…</option>
          {props.chargeTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={fields.idFor("amountCents")}
        label="Amount"
        isRequired
        hint="Including GST, if any."
        error={fields.errorFor("amountCents")}
      >
        <MoneyInput
          {...fields.boxProps("amountCents")}
          onValueChange={(value) => fields.setValue("amountCents", value)}
        />
      </FormField>
      <FormField
        htmlFor={fields.idFor("description")}
        label="Description"
        isRequired
        hint="What the Renter will read on their statement."
        error={fields.errorFor("description")}
      >
        <Input {...fields.textBoxProps("description")} placeholder="e.g. Interior cleaning" />
      </FormField>
      <FormField
        htmlFor={fields.idFor("effectiveOn")}
        label="Date"
        isRequired
        error={fields.errorFor("effectiveOn")}
      >
        <Input {...fields.textBoxProps("effectiveOn")} type="date" />
      </FormField>
      {collectionChoices.length > 0 ? (
        <CollectionFields fields={fields} choices={collectionChoices} />
      ) : null}
    </ChangeFormShell>
  );
}
