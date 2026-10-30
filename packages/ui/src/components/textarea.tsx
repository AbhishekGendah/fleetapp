import * as React from "react";

import { cn } from "../lib/utils";

/** A box for several lines of text, styled like Input. `text-base` keeps iOS from zooming in. */
const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground focus-visible:ring-ring aria-invalid:border-destructive flex min-h-28 w-full rounded-md border px-3 py-2 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
