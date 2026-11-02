"use client";

import { fieldErrorsOf, type CAR_AREAS } from "@fleetapp/core";
import { CarAreaSelect, CarOutline } from "@fleetapp/ui/car-outline";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useMemo, useState } from "react";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  emptyFoundDamageForm,
  FOUND_DAMAGE_FIELDS,
  foundDamageFormSchema,
} from "../../../lib/damage/damage-input";
import { FOUND_DAMAGE_LABELS } from "../../../lib/damage/damage-labels";

const REQUIRED_FIELDS: ReadonlySet<string> = new Set(["foundOn", "description"]);

/**
 * Damage found away from a checklist: a walk-round, a Renter's report, a car
 * park bump. Who had the car is suggested on its page afterwards, from who
 * had it on the day (rule 15).
 */
export function FoundDamageForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  today: string;
}) {
  const schema = useMemo(() => foundDamageFormSchema(props.today), [props.today]);
  const form = useChangeForm({
    action: props.action,
    fields: FOUND_DAMAGE_FIELDS,
    initialValues: emptyFoundDamageForm(props.today),
    validate: (values) => fieldErrorsOf(schema.safeParse(values)),
    isRequired: (field) => REQUIRED_FIELDS.has(field),
    shouldClearOnSave: true,
  });
  const { fields } = form;
  const [area, setArea] = useState("");
  const place =
    fields.values.x === "" || fields.values.y === ""
      ? null
      : { x: Number(fields.values.x), y: Number(fields.values.y) };

  function placeAt(position: { x: number; y: number } | null): void {
    fields.setValue("x", position ? String(position.x) : "");
    fields.setValue("y", position ? String(position.y) : "");
  }

  function handleAreaChosen(picked: (typeof CAR_AREAS)[number] | null): void {
    setArea(picked?.key ?? "");
    placeAt(picked);
  }

  return (
    <ChangeFormShell form={form} submitLabel="Record damage">
      <FormField
        htmlFor={fields.idFor("foundOn")}
        label={FOUND_DAMAGE_LABELS.foundOn}
        isRequired
        error={fields.errorFor("foundOn")}
      >
        <Input {...fields.textBoxProps("foundOn")} type="date" max={props.today} />
      </FormField>
      <FormField
        htmlFor={fields.idFor("description")}
        label={FOUND_DAMAGE_LABELS.description}
        isRequired
        error={fields.errorFor("description")}
      >
        <Input {...fields.textBoxProps("description")} placeholder="e.g. Dent in the rear door" />
      </FormField>
      <FormField
        htmlFor="found-damage-area"
        label={FOUND_DAMAGE_LABELS.x}
        hint="Tap the outline, or choose the area."
        error={fields.errorFor("x")}
      >
        <CarAreaSelect id="found-damage-area" value={area} onAreaChosen={handleAreaChosen} />
      </FormField>
      <CarOutline
        label="Car outline: tap where the damage is"
        marks={place ? [{ id: "new", ...place, label: "Damage 1: the place marked" }] : []}
        onPlace={(position) => {
          setArea("");
          placeAt(position);
        }}
      />
      <input type="hidden" name="x" value={fields.values.x} />
      <input type="hidden" name="y" value={fields.values.y} />
      <input type="hidden" name="rentalId" value="" />
    </ChangeFormShell>
  );
}
