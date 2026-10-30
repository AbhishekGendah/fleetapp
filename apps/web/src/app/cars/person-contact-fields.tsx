"use client";

import { formatAustralianPhone, type AustralianStateCode } from "@fleetapp/core";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input } from "@fleetapp/ui/input";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { AddressSearch } from "../../components/address-search";
import { singleLineAddress } from "../../lib/address-lookup/address-from-components";
import { CostField } from "./cost-field";

/** A seller's or buyer's name, phone and address, the address searchable and kept on one line. */
export function PersonContactFields<Field extends string>(props: {
  form: FormFields<Field>;
  nameField: Field;
  phoneField: Field;
  addressField: Field;
  /** Addresses in this state are suggested first. */
  nearState: AustralianStateCode | null;
}) {
  const { form, nameField, phoneField, addressField } = props;
  return (
    <>
      <CostField form={form} field={nameField}>
        <Input {...form.textBoxProps(nameField)} autoComplete="off" />
      </CostField>
      <CostField form={form} field={phoneField}>
        <FormattedInput
          {...form.formattedBoxProps(phoneField, formatAustralianPhone)}
          type="tel"
          inputMode="tel"
          autoComplete="off"
        />
      </CostField>
      <CostField form={form} field={addressField}>
        <AddressSearch
          {...form.boxProps(addressField)}
          placeholder="Start typing to search"
          autoComplete="off"
          onValueChange={(value) => form.setValue(addressField, value)}
          onAddressChosen={(address) =>
            form.fillIn({ [addressField]: singleLineAddress(address) } as Partial<
              Record<Field, string>
            >)
          }
          nearState={props.nearState}
        />
      </CostField>
    </>
  );
}
