"use client";

import { parseDateTime, type CalendarDateTime } from "@internationalized/date";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import {
  Button,
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Popover,
} from "react-aria-components";

import { cn } from "../lib/utils";
import { fieldLabelId } from "./form-field";

/** Australian order (day, month, year) and the 12-hour clock. */
const LOCALE = "en-AU";
/** "2026-12-01T09:00": the form's own text for a date and time, with no seconds. */
const DATE_TIME_TEXT_LENGTH = 16;

function toCalendarValue(text: string): CalendarDateTime | null {
  if (text === "") {
    return null;
  }
  try {
    return parseDateTime(text);
  } catch (error) {
    // Half-typed or from an older form: shown as empty; the form's own check names the problem.
    if (error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

function toText(value: CalendarDateTime | null): string {
  return value ? value.toString().slice(0, DATE_TIME_TEXT_LENGTH) : "";
}

export interface DateTimePickerProps {
  /** The box's id: its label points at it, and the form moves to it when it has a problem. */
  id: string;
  /** Sent with the form, as "2026-12-01T09:00" on the Operator's clock. */
  name: string;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: (event: React.FocusEvent<HTMLElement>) => void;
  /** Lets the form move to this box when it has a problem. */
  ref?: React.Ref<HTMLDivElement>;
  "aria-required"?: boolean | "true" | "false";
  "aria-invalid"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  isDisabled?: boolean;
}

/**
 * A date and time on React Aria's DatePicker: typed part by part (day,
 * month, year, hour, minute, am/pm), or picked from a calendar. Works by
 * keyboard and screen reader, in Australian order. The form gets plain text
 * ("2026-12-01T09:00") to check and send, as from any other box.
 */
export function DateTimePicker({
  id,
  name,
  value,
  onValueChange,
  onBlur,
  ref,
  isDisabled,
  ...aria
}: DateTimePickerProps): React.JSX.Element {
  const isRequired = aria["aria-required"] === true || aria["aria-required"] === "true";
  const isInvalid = aria["aria-invalid"] === true || aria["aria-invalid"] === "true";

  // The label above (FormField's) names the box; a label cannot point at a group of parts.
  const moveToFirstPart = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      event.currentTarget.querySelector<HTMLElement>('[role="spinbutton"]')?.focus();
    }
  };

  return (
    <I18nProvider locale={LOCALE}>
      <DatePicker
        granularity="minute"
        hourCycle={12}
        value={toCalendarValue(value)}
        onChange={(next) => onValueChange(toText(next))}
        isRequired={isRequired}
        isInvalid={isInvalid}
        isDisabled={isDisabled}
        // Our own checks speak; the browser's pop-up messages would say something else.
        validationBehavior="aria"
        aria-labelledby={fieldLabelId(id)}
        aria-describedby={aria["aria-describedby"]}
        shouldForceLeadingZeros
      >
        <Group
          id={id}
          ref={ref}
          tabIndex={-1}
          onFocus={moveToFirstPart}
          onBlur={onBlur}
          className={cn(
            "border-input bg-card ring-offset-background focus-within:ring-ring flex h-11 w-full items-center rounded-md border pl-3 text-base shadow-sm focus-within:ring-2 focus-within:ring-offset-2",
            isInvalid && "border-destructive",
            isDisabled && "cursor-not-allowed opacity-50",
          )}
        >
          <DateInput className="flex flex-1 flex-wrap">
            {(segment) => (
              <DateSegment
                segment={segment}
                className="focus:bg-primary focus:text-primary-foreground data-[placeholder]:text-muted-foreground rounded px-0.5 tabular-nums outline-none"
              />
            )}
          </DateInput>
          <Button
            aria-label="Choose from a calendar"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-11 w-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
          >
            <CalendarDays aria-hidden="true" className="h-5 w-5" />
          </Button>
        </Group>
        <Popover className="bg-card rounded-md border p-3 shadow-lg" placement="bottom end">
          <Dialog className="outline-none" aria-label="Calendar">
            <MonthCalendar />
          </Dialog>
        </Popover>
      </DatePicker>
      <input type="hidden" name={name} value={value} />
    </I18nProvider>
  );
}

const CALENDAR_BUTTON_CLASS =
  "hover:bg-muted focus-visible:ring-ring flex h-11 w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2";

/** A month to pick a day from: every day is a 44px target (rule 24). */
function MonthCalendar(): React.JSX.Element {
  return (
    <Calendar className="flex flex-col gap-2">
      <header className="flex items-center justify-between">
        <Button slot="previous" aria-label="Previous month" className={CALENDAR_BUTTON_CLASS}>
          <ChevronLeft aria-hidden="true" className="h-5 w-5" />
        </Button>
        <Heading className="text-sm font-medium" />
        <Button slot="next" aria-label="Next month" className={CALENDAR_BUTTON_CLASS}>
          <ChevronRight aria-hidden="true" className="h-5 w-5" />
        </Button>
      </header>
      <CalendarGrid className="border-separate border-spacing-0">
        {(date) => (
          <CalendarCell
            date={date}
            className={cn(
              CALENDAR_BUTTON_CLASS,
              "text-sm tabular-nums",
              "data-[outside-month]:text-muted-foreground data-[selected]:bg-primary data-[selected]:text-primary-foreground data-[disabled]:opacity-50",
            )}
          />
        )}
      </CalendarGrid>
    </Calendar>
  );
}
