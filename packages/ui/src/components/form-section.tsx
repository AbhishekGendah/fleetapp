import type * as React from "react";

/** A titled group of boxes within a form, e.g. "Address". */
export function FormSection(props: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-primary mb-1 text-base font-semibold">{props.title}</legend>
      {props.children}
    </fieldset>
  );
}
