"use client";

import { Select } from "./select";

/** A dropdown that applies itself: choosing an option submits its form. */
export function AutoSubmitSelect(
  props: React.ComponentPropsWithoutRef<"select">,
): React.JSX.Element {
  return (
    <Select
      {...props}
      onChange={(event) => {
        props.onChange?.(event);
        event.currentTarget.form?.requestSubmit();
      }}
    />
  );
}
