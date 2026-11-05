"use client";

import {
  describeErrorForLog,
  digitsOnly,
  fieldErrorsOf,
  formatKilometres,
  formatKilometresAsTyped,
  FUEL_LEVEL_LABELS,
  FUEL_LEVELS,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { Textarea } from "@fleetapp/ui/textarea";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";

import {
  HANDOVER_DETAIL_FIELDS,
  handoverDetailsFormSchema,
  REQUIRED_HANDOVER_DETAILS,
  type HandoverDetailField,
} from "../../../../lib/handover/handover-input";
import { saveDraft } from "../../../../lib/handover/offline/handover-store";
import { TIMED_OUT, withinTime } from "../../../../lib/within-time";
import { saveHandoverDetailsAction } from "./actions";

const OFFLINE_MESSAGE = "No signal: kept on this phone. It saves itself when the signal is back.";

type SaveState = "idle" | "saving" | "saved" | "offline";

/** How long a save may take on weak signal before the button is given back. */
const SAVE_TIME_LIMIT_MS = 20_000;
const NOT_SAVED_MESSAGE =
  "Couldn't save just now. The details are kept on this phone: press Save details again when there is signal.";

/** The save's answer, or a "not saved" problem when it failed or hung (review A10-5). */
async function savedWithinTime<Result extends { status: string }>(
  step: Promise<Result>,
): Promise<Result | { status: "problem"; message: string }> {
  try {
    const result = await withinTime(step, SAVE_TIME_LIMIT_MS);
    return result === TIMED_OUT ? { status: "problem", message: NOT_SAVED_MESSAGE } : result;
  } catch (error) {
    console.warn("Saving the checklist details did not finish", describeErrorForLog(error));
    return { status: "problem", message: NOT_SAVED_MESSAGE };
  }
}

/**
 * The kilometres, fuel, keys, accessories and notes. Everything typed is
 * kept on the phone as it is typed (rule 25), and saved to the server when
 * Save is pressed, or once the signal is back if it was pressed without.
 */
export function ChecklistDetails(props: {
  rentalId: string;
  inspectionId: string;
  initialValues: Record<HandoverDetailField, string>;
  lastKilometres: number | null;
  /** At a return: the handover's fuel, shown beside the box to compare. */
  handoverFuel?: string | null;
  /** Told when a detail is changed and not yet saved, and again once it is (review G9-2). */
  onUnsavedChange?: (isUnsaved: boolean) => void;
}) {
  const form = useFormFields({
    fields: HANDOVER_DETAIL_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(handoverDetailsFormSchema.safeParse(values)),
    isRequired: (field) => REQUIRED_HANDOVER_DETAILS.has(field),
    idPrefix: "handover-",
  });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const { values } = form;
  const valuesKey = JSON.stringify(values);

  useEffect(() => {
    void saveDraft(props.inspectionId, JSON.parse(valuesKey) as Record<string, string>);
  }, [props.inspectionId, valuesKey]);

  async function save(): Promise<void> {
    if (!navigator.onLine) {
      setSaveState("offline");
      return;
    }
    setSaveState("saving");
    const result = await savedWithinTime(
      saveHandoverDetailsAction(props.rentalId, props.inspectionId, values),
    );
    setProblem(result.status === "problem" ? result.message : null);
    setSaveState(result.status === "saved" ? "saved" : "idle");
    if (result.status === "saved") {
      props.onUnsavedChange?.(false);
    }
  }

  useEffect(() => {
    if (saveState !== "offline") {
      return;
    }
    const handleOnline = () => void save();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  });

  return (
    <form
      onSubmit={form.submitHandler(() => void save())}
      noValidate
      className="flex flex-col gap-4"
      onChange={() => {
        setSaveState("idle");
        props.onUnsavedChange?.(true);
      }}
    >
      <RequiredFieldsNote />
      <FormField
        htmlFor={form.idFor("odometerKm")}
        label="Odometer (km)"
        isRequired
        hint={
          props.lastKilometres === null
            ? undefined
            : `Last reading: ${formatKilometres(props.lastKilometres)}.`
        }
        error={form.errorFor("odometerKm")}
      >
        <FormattedInput
          {...form.formattedBoxProps("odometerKm", formatKilometresAsTyped)}
          inputMode="numeric"
        />
      </FormField>
      <FormField
        htmlFor={form.idFor("fuelLevel")}
        label="Fuel"
        isRequired
        hint={props.handoverFuel ? `At handover: ${props.handoverFuel}.` : undefined}
        error={form.errorFor("fuelLevel")}
      >
        <Select
          {...form.boxProps("fuelLevel")}
          onChange={(event) => form.setValue("fuelLevel", event.target.value)}
        >
          <option value="">Choose the fuel level</option>
          {FUEL_LEVELS.map((level) => (
            <option key={level} value={level}>
              {FUEL_LEVEL_LABELS[level]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={form.idFor("keysCount")}
        label="Keys handed over"
        isRequired
        error={form.errorFor("keysCount")}
      >
        <Input
          {...form.textBoxProps("keysCount")}
          onChange={(event) =>
            form.setValue("keysCount", digitsOnly(event.target.value).slice(0, 1))
          }
          maxLength={1}
          inputMode="numeric"
          className="w-20"
        />
      </FormField>
      <FormField
        htmlFor={form.idFor("accessories")}
        label="Accessories"
        hint="E.g. phone holder, charging cable, child seat."
        error={form.errorFor("accessories")}
      >
        <Input {...form.textBoxProps("accessories")} />
      </FormField>
      <FormField htmlFor={form.idFor("notes")} label="Notes" error={form.errorFor("notes")}>
        <Textarea
          {...form.boxProps("notes")}
          onChange={(event) => form.setValue("notes", event.target.value)}
          rows={3}
        />
      </FormField>
      <FormError message={problem} />
      {saveState === "offline" ? (
        <p role="status" className="text-attention text-sm font-medium">
          {OFFLINE_MESSAGE}
        </p>
      ) : null}
      {saveState === "saved" ? (
        <p role="status" className="text-teal text-sm font-medium">
          Saved.
        </p>
      ) : null}
      <Button
        type="submit"
        variant="outline"
        disabled={saveState === "saving"}
        className="sm:self-start"
      >
        <Save aria-hidden />
        {saveState === "saving" ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}
