import type * as React from "react";

import { cn } from "../lib/utils";

type CheckboxProps = Omit<React.ComponentPropsWithoutRef<"input">, "type"> & {
  label: React.ReactNode;
};

/**
 * A tick box with its label, the whole row tappable. `min-h-11` keeps it a
 * 44px touch target (rule 24); the tick colour comes from the theme.
 */
export function Checkbox({ label, className, ...props }: CheckboxProps): React.JSX.Element {
  return (
    <label className={cn("flex min-h-11 items-center gap-3 text-sm", className)}>
      <input type="checkbox" className="size-5" {...props} />
      {label}
    </label>
  );
}
