"use client";

import { formatAustralianPhone } from "@fleetapp/core";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { FormSection } from "@fleetapp/ui/form-section";
import { Input } from "@fleetapp/ui/input";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { AddressSearch, type AddressLookup } from "../../components/address-search";
import { singleLineAddress } from "../../lib/address-lookup/address-from-components";
import { TICKED_VALUE, type RenterFormField } from "../../lib/renters/renter-input";
import { RENTER_FIELD_LABELS } from "../../lib/renters/renter-labels";

const CONTACT_HINT = "A phone number or an email, or both.";

interface RenterDetailsFieldsProps {
  form: FormFields<RenterFormField>;
  /** The Operator's today, for the date-of-birth check. */
  today: string;
  isRequired: (field: RenterFormField) => boolean;
  /** "The Renter" on the Operator's form, "Your details" on the Renter's link. */
  title: string;
  /** Speaking about the Renter ("their licence") or to them ("your licence"). */
  nameHints: { fullName: string; preferredName: string };
  /** The Renter link's own, limited address lookup; the signed-in User's otherwise. */
  addressLookup?: AddressLookup;
}

/**
 * A Renter's details, address and emergency contact: the same boxes on the
 * Operator's form and on the form a Renter fills in through their link.
 */
export function RenterDetailsFields(props: RenterDetailsFieldsProps) {
  const { form } = props;
  const isPostalSameAsHome = form.values.isPostalSameAsHome === TICKED_VALUE;

  function fieldProps(field: RenterFormField) {
    return {
      htmlFor: field,
      label: RENTER_FIELD_LABELS[field],
      isRequired: props.isRequired(field),
      error: form.errorFor(field),
    };
  }

  function addressBox(field: "residentialAddress" | "postalAddress") {
    return (
      <AddressSearch
        {...form.boxProps(field)}
        placeholder="Start typing to search"
        autoComplete="off"
        onValueChange={(value) => form.setValue(field, value)}
        onAddressChosen={(address) => form.fillIn({ [field]: singleLineAddress(address) })}
        nearState={null}
        lookup={props.addressLookup}
      />
    );
  }

  return (
    <>
      <FormSection title={props.title}>
        <FormField {...fieldProps("fullName")} hint={props.nameHints.fullName}>
          <Input {...form.textBoxProps("fullName")} autoComplete="off" />
        </FormField>
        <FormField {...fieldProps("preferredName")} hint={props.nameHints.preferredName}>
          <Input {...form.textBoxProps("preferredName")} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField {...fieldProps("phone")} hint={CONTACT_HINT}>
            <FormattedInput
              {...form.formattedBoxProps("phone", formatAustralianPhone)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />
          </FormField>
          <FormField {...fieldProps("email")}>
            <Input
              {...form.textBoxProps("email")}
              onChange={(event) => form.setValue("email", event.target.value.toLowerCase())}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="off"
            />
          </FormField>
        </div>
        <FormField {...fieldProps("dateOfBirth")}>
          <Input {...form.textBoxProps("dateOfBirth")} type="date" max={props.today} />
        </FormField>
      </FormSection>

      <FormSection title="Address">
        <FormField {...fieldProps("residentialAddress")}>
          {addressBox("residentialAddress")}
        </FormField>
        <Checkbox
          name="isPostalSameAsHome"
          label={RENTER_FIELD_LABELS.isPostalSameAsHome}
          checked={isPostalSameAsHome}
          onChange={(event) =>
            form.setValue("isPostalSameAsHome", event.target.checked ? TICKED_VALUE : "")
          }
        />
        {isPostalSameAsHome ? null : (
          <FormField {...fieldProps("postalAddress")}>{addressBox("postalAddress")}</FormField>
        )}
      </FormSection>

      <FormSection title="Emergency contact">
        <FormField {...fieldProps("emergencyContactName")}>
          <Input {...form.textBoxProps("emergencyContactName")} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField {...fieldProps("emergencyContactPhone")}>
            <FormattedInput
              {...form.formattedBoxProps("emergencyContactPhone", formatAustralianPhone)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />
          </FormField>
          <FormField {...fieldProps("emergencyContactRelationship")}>
            <Input
              {...form.textBoxProps("emergencyContactRelationship")}
              placeholder="e.g. Partner"
              autoComplete="off"
            />
          </FormField>
        </div>
      </FormSection>
    </>
  );
}
