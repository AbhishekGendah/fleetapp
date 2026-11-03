"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { STATEMENT_FIELDS, statementRangeSchema } from "../../../lib/billing/statement-input";

/** The days a statement covers: from the rental's first day to today, unless changed. */
export function StatementForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  fromDate: string;
  today: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: STATEMENT_FIELDS,
    initialValues: { fromDate: props.fromDate, toDate: props.today },
    validate: (values) => fieldErrorsOf(statementRangeSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Make statement">
      <FormField
        htmlFor={fields.idFor("fromDate")}
        label="First day"
        isRequired
        error={fields.errorFor("fromDate")}
      >
        <Input {...fields.textBoxProps("fromDate")} type="date" />
      </FormField>
      <FormField
        htmlFor={fields.idFor("toDate")}
        label="Last day"
        isRequired
        error={fields.errorFor("toDate")}
      >
        <Input {...fields.textBoxProps("toDate")} type="date" />
      </FormField>
    </ChangeFormShell>
  );
}
