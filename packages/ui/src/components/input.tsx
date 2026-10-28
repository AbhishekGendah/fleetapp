import * as React from "react";

import { cn } from "../lib/utils";

/**
 * `h-11` is 44px: the minimum touch target size this project designs to
 * (rule 24). `text-base` keeps iOS Safari from zooming the page on focus.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "border-input bg-card ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring aria-invalid:border-destructive flex h-11 w-full rounded-md border px-3 py-2 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

type LabelProps = React.ComponentPropsWithoutRef<"label"> & {
  /**
   * Shows a red asterisk. Screen readers skip it: they hear "required" from
   * the box itself, which must also carry `required` or `aria-required`.
   */
  isRequired?: boolean;
};

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, isRequired, children, ...props }, ref) => (
    <label ref={ref} className={cn("text-sm leading-none font-medium", className)} {...props}>
      {children}
      {isRequired ? (
        <span aria-hidden="true" className="text-destructive">
          {" "}
          *
        </span>
      ) : null}
    </label>
  ),
);
Label.displayName = "Label";

/** Goes at the top of any form that has an asterisk on it. */
function RequiredFieldsNote({ className }: { className?: string }): React.JSX.Element {
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      Fields marked <span className="text-destructive">*</span> are required.
    </p>
  );
}

export { Input, Label, RequiredFieldsNote };
