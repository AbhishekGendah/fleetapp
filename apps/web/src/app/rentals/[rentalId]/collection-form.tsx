"use client";

import {
  debitPlanLabelOn,
  fieldErrorsOf,
  formatShortCalendarDate,
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

/** The first day a charge may be debited, and today, both on the business's calendar. */
export interface CollectionNotice {
  noticeDate: string;
  today: string;
}

/**
 * How a one-off charge is collected when the Renter pays by direct debit
 * (slice 5): the plan, and for a split how many weekly debits (2 to 12,
 * digits only), each named with the first day it may be debited: never
 * before its invoice has been emailed and the notice period has run
 * (docs/plans/one-off-charge-notice.md). Shared by the charge form and
 * changing a charge's plan.
 */
export function CollectionFields<Field extends string>(props: {
  fields: FormFields<Field | CollectionField>;
  choices: readonly DebitCollectionPlan[];
  notice: CollectionNotice;
  hint: string;
}) {
  const { fields, notice } = props;
  return (
    <>
      <FormField
        htmlFor={fields.idFor("collection")}
        label="How to collect it"
        isRequired
        hint={props.hint}
        error={fields.errorFor("collection")}
      >
        <Select
          {...fields.boxProps("collection")}
          onChange={(event) => fields.setValue("collection", event.target.value)}
        >
          {props.choices.map((plan) => (
            <option key={plan} value={plan}>
              {debitPlanLabelOn(plan, notice.noticeDate, notice.today)}
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

/** The hint for a new charge: its invoice goes now, and nothing is debited before its day. */
export function newChargeCollectionHint(notice: CollectionNotice): string {
  return `The Renter pays by direct debit. The invoice is emailed to them now, and nothing is debited before ${formatShortCalendarDate(notice.noticeDate, notice.today)}. A debit counts as paid once the bank clears it.`;
}

/** Changes how a one-off charge is collected, until any part of it is debited. */
export function CollectionForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  choices: readonly DebitCollectionPlan[];
  current: { plan: DebitCollectionPlan; weeks: number | null };
  /** Its own notice date if it has one, or the day it would have if its invoice were emailed now. */
  notice: CollectionNotice & { isGiven: boolean };
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
      <CollectionFields
        fields={form.fields}
        choices={props.choices}
        notice={props.notice}
        hint={
          props.notice.isGiven
            ? `The Renter was told it may be debited from ${formatShortCalendarDate(props.notice.noticeDate, props.notice.today)}; nothing is debited before then.`
            : `If it is to be debited, its invoice is emailed to the Renter again with the date, and nothing is debited before ${formatShortCalendarDate(props.notice.noticeDate, props.notice.today)}.`
        }
      />
    </ChangeFormShell>
  );
}
