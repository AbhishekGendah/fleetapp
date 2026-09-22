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
        "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-11 w-full rounded-md border px-3 py-2 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

const Label = React.forwardRef<HTMLLabelElement, React.ComponentPropsWithoutRef<"label">>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("text-sm leading-none font-medium", className)} {...props} />
  ),
);
Label.displayName = "Label";

export { Input, Label };
