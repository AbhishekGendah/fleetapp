import {
  PART_WEEK_CHARGING,
  PART_WEEK_CHARGING_LABELS,
  REQUIRED_MESSAGE,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type OperatorSettings,
} from "@fleetapp/core";
import { z } from "zod";

/** One option of a pick-one setting: what the box sends, what it reads, what is stored. */
interface ChoiceOption<Stored> {
  value: string;
  label: string;
  stored: Stored;
}

const YES_NO = (yes: string, no: string): readonly ChoiceOption<boolean>[] => [
  { value: "yes", label: yes, stored: true },
  { value: "no", label: no, stored: false },
];

/** The value the "start's weekday" option sends: the box cannot send nothing. */
const START_WEEKDAY_VALUE = "start";

/**
 * The settings that are one of a few choices, each with its options. The
 * stored values are exactly what the settings schema in core takes.
 */
const CHOICE_SETTING_OPTIONS = {
  isProvisionalLicenceAllowed: YES_NO(
    "Yes, a provisional licence may rent",
    "No, a full or overseas licence only",
  ),
  fixedChargeWeekday: [
    { value: START_WEEKDAY_VALUE, label: "The weekday each rental starts on", stored: null },
    ...WEEKDAYS.map((day) => ({ value: String(day), label: WEEKDAY_LABELS[day], stored: day })),
  ],
  partWeekCharging: PART_WEEK_CHARGING.map((choice) => ({
    value: choice,
    label: PART_WEEK_CHARGING_LABELS[choice],
    stored: choice,
  })),
  isBondRequiredBeforeHandover: YES_NO(
    "Yes, the full bond is held before handover",
    "No, the car can go before the bond is in",
  ),
} as const satisfies {
  [Setting in keyof OperatorSettings]?: readonly ChoiceOption<OperatorSettings[Setting]>[];
};

export type ChoiceSetting = keyof typeof CHOICE_SETTING_OPTIONS;

export function isChoiceSetting(value: string): value is ChoiceSetting {
  return Object.hasOwn(CHOICE_SETTING_OPTIONS, value);
}

/** The options as the box shows them. */
export function choiceSettingOptions(
  setting: ChoiceSetting,
): readonly { value: string; label: string }[] {
  return CHOICE_SETTING_OPTIONS[setting].map(({ value, label }) => ({ value, label }));
}

/** The option for what is stored now. */
export function choiceSettingValue(setting: ChoiceSetting, stored: unknown): string {
  const options: readonly ChoiceOption<unknown>[] = CHOICE_SETTING_OPTIONS[setting];
  return options.find((option) => option.stored === stored)?.value ?? options[0]!.value;
}

export const CHOICE_SETTING_FIELDS = ["choice"] as const;

/** One pick-one setting's box: one of its options, as the value the settings store. */
export function choiceSettingInputSchema(
  setting: ChoiceSetting,
): z.ZodType<{ choice: unknown }, { choice: string }> {
  const options: readonly ChoiceOption<unknown>[] = CHOICE_SETTING_OPTIONS[setting];
  return z.object({
    choice: z
      .string()
      .refine((value) => options.some((option) => option.value === value), REQUIRED_MESSAGE)
      .transform((value) => options.find((option) => option.value === value)!.stored),
  });
}
