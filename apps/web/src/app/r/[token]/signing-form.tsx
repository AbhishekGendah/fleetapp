"use client";

import {
  SIGN_CONTRACT_FIELDS,
  SIGNING_CONSENT_TEXT,
  signContractInputSchema,
  type SignatureMethod,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { FormSection } from "@fleetapp/ui/form-section";
import { Input, RequiredFieldsNote, RequiredMark } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { SignaturePad } from "@fleetapp/ui/signature-pad";
import { useFormFields, type FormFields } from "@fleetapp/ui/use-form-fields";
import { PenLine } from "lucide-react";
import { useActionState, useMemo } from "react";
import { z } from "zod";

import { signContractAction } from "./signing-actions";
import { INITIAL_SIGN_STATE } from "./signing-state";

type SignField = (typeof SIGN_CONTRACT_FIELDS)[number];
const TICKED = "on";
const ALWAYS_REQUIRED = new Set<SignField>(["areDetailsConfirmed", "hasConsented", "method"]);
const METHOD_CHOICES: readonly { method: SignatureMethod; label: string }[] = [
  { method: "drawn", label: "Draw my signature" },
  { method: "typed", label: "Type my full name" },
];

function isRequiredSignField(field: SignField, values: Readonly<Record<SignField, string>>) {
  if (ALWAYS_REQUIRED.has(field)) {
    return true;
  }
  return (
    (field === "typedName" && values.method === "typed") ||
    (field === "drawnSignature" && values.method === "drawn")
  );
}

/** A required tick box, with its asterisk and its message read out with it. */
function RequiredTick(props: { form: FormFields<SignField>; field: SignField; label: string }) {
  const { form, field } = props;
  const error = form.errorFor(field);
  return (
    <div className="flex flex-col gap-1">
      <Checkbox
        {...form.boxProps(field)}
        value={TICKED}
        checked={form.values[field] === TICKED}
        onChange={(event) => form.setValue(field, event.target.checked ? TICKED : "")}
        required
        label={
          <span>
            {props.label} <RequiredMark />
          </span>
        }
      />
      {error ? (
        <p id={fieldErrorId(form.idFor(field))} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SignatureFields({ form }: { form: FormFields<SignField> }) {
  if (form.values.method === "typed") {
    return (
      <FormField
        htmlFor={form.idFor("typedName")}
        label="Your full name"
        isRequired
        hint="Exactly as it is in the details above."
        error={form.errorFor("typedName")}
      >
        <Input {...form.textBoxProps("typedName")} autoComplete="name" />
      </FormField>
    );
  }
  return (
    <FormField
      htmlFor={form.idFor("drawnSignature")}
      label="Your signature"
      isRequired
      hint="Draw it in the box with your finger."
      error={form.errorFor("drawnSignature")}
    >
      <SignaturePad
        id={form.idFor("drawnSignature")}
        name="drawnSignature"
        onValueChange={(value) => form.setValue("drawnSignature", value)}
        aria-invalid={form.errorFor("drawnSignature") ? true : undefined}
      />
    </FormField>
  );
}

/**
 * The last steps of signing: confirm the details shown above, agree to sign
 * electronically, then draw or type a signature. Checked as it is filled in
 * with the server's own rules; the server checks again and signs only the
 * text this page showed (its fingerprint).
 */
export function SigningForm(props: {
  token: string;
  renterFullName: string;
  contractFingerprint: string;
  /** What is signed, as the page names it: "contract" or "change of terms". */
  documentName: string;
  operatorName: string;
}) {
  const sign = useMemo(() => signContractAction.bind(null, props.token), [props.token]);
  const [state, formAction, isPending] = useActionState(sign, INITIAL_SIGN_STATE);
  const schema = useMemo(
    () => signContractInputSchema(props.renterFullName),
    [props.renterFullName],
  );
  const form = useFormFields({
    fields: SIGN_CONTRACT_FIELDS,
    initialValues: {
      areDetailsConfirmed: "",
      hasConsented: "",
      method: "drawn",
      typedName: "",
      drawnSignature: "",
      contractFingerprint: props.contractFingerprint,
    },
    validate: (values) => {
      const parsed = schema.safeParse(values);
      return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
    },
    isRequired: isRequiredSignField,
  });

  if (state.status === "signed") {
    return (
      <div role="status" className="bg-primary-soft flex flex-col gap-2 rounded-lg p-4">
        <p className="text-teal text-lg font-semibold">Signed. Thank you.</p>
        <p className="text-sm">
          You signed the {props.documentName} with {props.operatorName} on {state.signedAtText}. A
          copy has been emailed to you.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-6"
    >
      <RequiredFieldsNote />
      <input type="hidden" name="contractFingerprint" value={props.contractFingerprint} />
      <FormSection title="3. Agree">
        <RequiredTick
          form={form}
          field="areDetailsConfirmed"
          label={`My details above are right, and I have read the whole ${props.documentName}.`}
        />
        <RequiredTick form={form} field="hasConsented" label={SIGNING_CONSENT_TEXT} />
      </FormSection>
      <FormSection title="4. Sign">
        <FormField htmlFor={form.idFor("method")} label="How do you want to sign?" isRequired>
          <Select
            {...form.boxProps("method")}
            onChange={(event) => form.setValue("method", event.target.value)}
          >
            {METHOD_CHOICES.map((choice) => (
              <option key={choice.method} value={choice.method}>
                {choice.label}
              </option>
            ))}
          </Select>
        </FormField>
        <SignatureFields form={form} />
      </FormSection>
      {form.isResultShown && !isPending && state.status === "problem" ? (
        <FormError message={state.message} />
      ) : null}
      <Button type="submit" disabled={isPending} className="w-full">
        <PenLine aria-hidden />
        {isPending ? "Signing…" : `Sign the ${props.documentName}`}
      </Button>
    </form>
  );
}
