"use client";

import { useRef } from "react";

import { Select } from "./select";

/** Keys that move through a closed dropdown's options without choosing yet. */
const BROWSING_KEYS: ReadonlySet<string> = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * A dropdown that applies itself: choosing an option submits its form. With
 * the keyboard, stepping through options with the arrows does not reload the
 * list at every step (WCAG 3.2.2): the choice applies on Enter or on leaving.
 */
export function AutoSubmitSelect(
  props: React.ComponentPropsWithoutRef<"select">,
): React.JSX.Element {
  const isBrowsing = useRef(false);
  const isChanged = useRef(false);

  function apply(select: HTMLSelectElement): void {
    isBrowsing.current = false;
    if (isChanged.current) {
      isChanged.current = false;
      select.form?.requestSubmit();
    }
  }

  return (
    <Select
      {...props}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (BROWSING_KEYS.has(event.key)) {
          isBrowsing.current = true;
        } else if (event.key === "Enter") {
          event.preventDefault();
          apply(event.currentTarget);
        }
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        apply(event.currentTarget);
      }}
      onChange={(event) => {
        props.onChange?.(event);
        isChanged.current = true;
        if (!isBrowsing.current) {
          apply(event.currentTarget);
        }
      }}
    />
  );
}
