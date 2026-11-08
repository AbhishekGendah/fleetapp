"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";
import { fieldDescriptionIds, fieldErrorId, fieldHintId, fieldLabelId } from "./form-field";
import { RequiredMark } from "./input";

export interface ChoiceCard<Value extends string> {
  value: Value;
  label: string;
  /** A line under the label saying what choosing it means. */
  description: string;
  icon?: React.ReactNode;
}

export interface ChoiceCardsProps<Value extends string> {
  /** The group's id: its label, hint and error take theirs from it. */
  id: string;
  /** The form field the chosen value is sent as. */
  name: string;
  label: string;
  options: readonly ChoiceCard<Value>[];
  /** None chosen yet is allowed: a required choice is then flagged by its error. */
  value: Value | "";
  onValueChange: (value: Value) => void;
  isRequired?: boolean;
  hint?: string;
  error?: string;
}

/**
 * One of two or three choices that each need a line of explanation, as
 * large cards side by side (stacked on a phone): e.g. "Person or business?"
 * when adding a Renter. A real radio group: Tab reaches it, the arrow keys
 * move the choice, and its value is sent with the form. Built on Base UI's
 * RadioGroup; each card is at least 44px tall to tap (rule 24), and the
 * chosen one differs in its border, fill and tick, not only its colour.
 */
export function ChoiceCards<Value extends string>(
  props: ChoiceCardsProps<Value>,
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span id={fieldLabelId(props.id)} className="text-sm leading-none font-medium">
        {props.label}
        {props.isRequired ? <RequiredMark /> : null}
      </span>
      {/* The value goes with the form from here: one plain field, whatever the group renders. */}
      <input type="hidden" name={props.name} value={props.value} />
      <RadioGroup
        id={props.id}
        value={props.value}
        onValueChange={(value) => props.onValueChange(value as Value)}
        aria-labelledby={fieldLabelId(props.id)}
        aria-describedby={fieldDescriptionIds(props.id)}
        aria-required={props.isRequired || undefined}
        aria-invalid={props.error ? true : undefined}
        className="flex flex-col gap-2 sm:flex-row"
      >
        {props.options.map((option) => (
          <Radio.Root
            key={option.value}
            value={option.value}
            className={cn(
              "group bg-card text-primary flex min-h-16 flex-1 items-center gap-3 rounded-xl border p-3 text-left outline-none",
              "focus-visible:ring-ring focus-visible:ring-2",
              "data-[checked]:border-primary data-[checked]:bg-primary-soft data-[checked]:shadow-[inset_0_0_0_1px_var(--color-primary)]",
            )}
          >
            {option.icon ? (
              <span aria-hidden className="shrink-0 [&_svg]:size-6">
                {option.icon}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-extrabold">{option.label}</span>
              <span className="text-muted-foreground text-sm">{option.description}</span>
            </span>
            <span
              aria-hidden
              className="border-muted-foreground group-data-[checked]:border-primary group-data-[checked]:bg-primary flex size-5 shrink-0 items-center justify-center rounded-full border-2"
            >
              <Radio.Indicator className="text-primary-foreground flex">
                <Check className="size-3.5" strokeWidth={3} />
              </Radio.Indicator>
            </span>
          </Radio.Root>
        ))}
      </RadioGroup>
      {props.hint ? (
        <p id={fieldHintId(props.id)} className="text-muted-foreground text-xs">
          {props.hint}
        </p>
      ) : null}
      {props.error ? (
        <p id={fieldErrorId(props.id)} className="text-destructive text-sm">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
