"use client";

import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { singleLineAddress } from "../lib/address-lookup/address-from-components";
import { AddressSearch, type AddressLookup } from "./address-search";

/**
 * One address box of a form, searched as it is typed: picking a suggestion
 * fills it in on one line. The signed-in User's lookup unless given another
 * (a Renter link's limited one).
 */
export function FormAddressBox<Field extends string>(props: {
  form: FormFields<Field>;
  field: Field;
  lookup?: AddressLookup;
}) {
  const { form, field } = props;
  return (
    <AddressSearch
      {...form.boxProps(field)}
      placeholder="Start typing to search"
      autoComplete="off"
      onValueChange={(value) => form.setValue(field, value)}
      onAddressChosen={(address) =>
        form.fillIn({ [field]: singleLineAddress(address) } as Partial<Record<Field, string>>)
      }
      nearState={null}
      lookup={props.lookup}
    />
  );
}
