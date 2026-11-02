import type * as React from "react";

import { RequiredMark } from "./input";

/** A titled group of boxes within a form, e.g. "Address". */
export function FormSection(props: {
  title: string;
  /** Shows the asterisk when the section as a whole is needed, e.g. both photos of a licence. */
  isRequired?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="text-primary mb-1 text-base font-semibold">
        {props.title}
        {props.isRequired ? <RequiredMark /> : null}
      </legend>
      {props.children}
    </fieldset>
  );
}
