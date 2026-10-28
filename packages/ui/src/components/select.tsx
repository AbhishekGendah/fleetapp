import * as React from "react";

import { cn } from "../lib/utils";

/**
 * The phone's own picker, styled like Input. A native select is the easiest
 * thing to use on a phone and needs nothing extra to be accessible.
 */
const Select = React.forwardRef<HTMLSelectElement, React.ComponentPropsWithoutRef<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "border-input bg-card focus-visible:ring-ring aria-invalid:border-destructive flex h-11 w-full rounded-md border px-3 py-2 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export { Select };
