import { FormError } from "@fleetapp/ui/form-message";

import type { ChangeFormState } from "./change-form-state";

/** What came back from a form that changes a record: saved (or saved with a warning), or why not. */
export function FormResult({ state }: { state: ChangeFormState }) {
  if (state.status === "failed") {
    return <FormError message={state.formError} />;
  }
  if (state.status === "saved") {
    return (
      <p className={state.isWarning ? "text-attention text-sm" : "text-teal text-sm"} role="status">
        {state.message}
      </p>
    );
  }
  return null;
}
