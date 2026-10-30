"use client";

import { useEffect, useRef } from "react";

/** Marks the history step a pop-up adds, so only that step is ever taken back off. */
const POP_UP_STEP_MARKER = "fleetappPopUp";

function isOwnStepCurrent(): boolean {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null && POP_UP_STEP_MARKER in state;
}

/**
 * Makes the phone's back button close an open pop-up instead of leaving the
 * page. Opening adds a step to the browser's history; back takes it off and
 * closes the pop-up. Closing it any other way (✕, Done, saving) takes the
 * step off again, unless the page has already moved on (e.g. a save that
 * opens another page), so back never lands somewhere unexpected.
 */
export function useCloseOnBack(isOpen: boolean, close: () => void): void {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  }, [close]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // Keeps the router's own details on the step, so it treats it as the same page.
    const current: unknown = window.history.state;
    const routerState = typeof current === "object" && current !== null ? current : {};
    window.history.pushState({ ...routerState, [POP_UP_STEP_MARKER]: true }, "");
    let isStepTaken = false;
    const handleBack = (): void => {
      isStepTaken = true;
      closeRef.current();
    };
    window.addEventListener("popstate", handleBack);
    return () => {
      window.removeEventListener("popstate", handleBack);
      if (!isStepTaken && isOwnStepCurrent()) {
        window.history.back();
      }
    };
  }, [isOpen]);
}
