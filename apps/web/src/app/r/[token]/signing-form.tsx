"use client";

import {
  authorisedToSignText,
  SIGN_CONTRACT_FIELDS,
  SIGNATURE_METHOD_CHOICES,
  SIGNING_CONSENT_TEXT,
  signContractInputSchema,
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
import { ArrowRight, PenLine } from "lucide-react";
import { useActionState, useMemo } from "react";
import { z } from "zod";

import { goToPaymentsAction, signContractAction } from "./signing-actions";
import { INITIAL_SIGN_STATE } from "./signing-state";

type SignField = (typeof SIGN_CONTRACT_FIELDS)[number];
const TICKED = "on";
const ALWAYS_REQUIRED = new Set<SignField>(["areDetailsConfirmed", "hasConsented", "method"]);
/** A business's signer gives these too (decision 3). */
const AUTHORITY_FIELDS = new Set<SignField>(["signerName", "signerPosition", "isAuthorised"]);

function isRequiredSignField(
  field: SignField,
  values: Readonly<Record<SignField, string>>,
  isForBusiness: boolean,
) {
  if (ALWAYS_REQUIRED.has(field) || (isForBusiness && AUTHORITY_FIELDS.has(field))) {
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

/** Who signs for a business, in what position, and their word that they may. */
function AuthorityFields(props: { form: FormFields<SignField>; legalName: string }) {
  const { form } = props;
  return (
    <>
      <FormField
        htmlFor={form.idFor("signerName")}
        label="Your full name"
        isRequired
        hint={`You sign for ${props.legalName}.`}
        error={form.errorFor("signerName")}
      >
        <Input {...form.textBoxProps("signerName")} autoComplete="name" />
      </FormField>
      <FormField
        htmlFor={form.idFor("signerPosition")}
        label="Your position"
        isRequired
        hint="For example Director, Owner or Fleet manager."
        error={form.errorFor("signerPosition")}
      >
        <Input {...form.textBoxProps("signerPosition")} autoComplete="organization-title" />
      </FormField>
      <RequiredTick
        form={form}
        field="isAuthorised"
        label={authorisedToSignText(props.legalName)}
      />
    </>
  );
}

function SignatureFields({
  form,
  isForBusiness,
}: {
  form: FormFields<SignField>;
  isForBusiness: boolean;
}) {
  if (form.values.method === "typed") {
    return (
      <FormField
        htmlFor={form.idFor("typedName")}
        label={isForBusiness ? "Your signature: your full name typed" : "Your full name"}
        isRequired
        hint={
          isForBusiness ? "Exactly as you gave it above." : "Exactly as it is in the details above."
        }
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
  /** For a business Renter: its legal name, and its contact as the signer to start with. */
  authority: { legalName: string; contactName: string | null } | null;
  contractFingerprint: string;
  /** What is signed, as the page names it: "contract" or "change of terms". */
  documentName: string;
  operatorName: string;
}) {
  const sign = useMemo(() => signContractAction.bind(null, props.token), [props.token]);
  const [state, formAction, isPending] = useActionState(sign, INITIAL_SIGN_STATE);
  const legalName = props.authority?.legalName;
  const schema = useMemo(
    () => signContractInputSchema(props.renterFullName, legalName ? { legalName } : undefined),
    [props.renterFullName, legalName],
  );
  const isForBusiness = props.authority !== null;
  const form = useFormFields({
    fields: SIGN_CONTRACT_FIELDS,
    initialValues: {
      areDetailsConfirmed: "",
      hasConsented: "",
      method: "drawn",
      typedName: "",
      drawnSignature: "",
      contractFingerprint: props.contractFingerprint,
      signerName: props.authority?.contactName ?? "",
      signerPosition: "",
      isAuthorised: "",
    },
    validate: (values) => {
      const parsed = schema.safeParse(values);
      return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
    },
    isRequired: (field, values) => isRequiredSignField(field, values, isForBusiness),
  });

  if (state.status === "signed") {
    return (
      <div role="status" className="bg-primary-soft flex flex-col gap-2 rounded-lg p-4">
        <p className="text-teal text-lg font-semibold">Signed. Thank you.</p>
        <p className="text-sm">
          You signed the {props.documentName} with {props.operatorName} on {state.signedAtText}.{" "}
          {state.isCopyEmailed
            ? "A copy has been emailed to you."
            : `We couldn't email you a copy. Ask ${props.operatorName} to send it.`}
        </p>
        {state.paymentsNext ? (
          <form
            action={goToPaymentsAction.bind(
              null,
              state.paymentsNext.token,
              state.paymentsNext.deviceToken,
            )}
            className="flex flex-col gap-2"
          >
            <p className="text-sm">
              Next, set up your direct debit and pay the bond, on Stripe&apos;s secure page.
            </p>
            <Button type="submit" className="w-full">
              <ArrowRight aria-hidden />
              Set up your payments
            </Button>
          </form>
        ) : null}
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
          label={`${isForBusiness ? "The" : "My"} details above are right, and I have read the whole ${props.documentName}.`}
        />
        <RequiredTick form={form} field="hasConsented" label={SIGNING_CONSENT_TEXT} />
      </FormSection>
      <FormSection title="4. Sign">
        {props.authority ? (
          <AuthorityFields form={form} legalName={props.authority.legalName} />
        ) : null}
        <FormField htmlFor={form.idFor("method")} label="How do you want to sign?" isRequired>
          <Select
            {...form.boxProps("method")}
            onChange={(event) => form.setValue("method", event.target.value)}
          >
            {SIGNATURE_METHOD_CHOICES.map((choice) => (
              <option key={choice.method} value={choice.method}>
                {choice.label}
              </option>
            ))}
          </Select>
        </FormField>
        <SignatureFields form={form} isForBusiness={isForBusiness} />
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
