import { FormError } from "./form-message";

import type { ChangeFormState, FormResultLink } from "./change-form-state";

function ResultLink({ link }: { link: FormResultLink | undefined }) {
  return link ? (
    <a href={link.href} className="text-teal text-sm font-semibold hover:underline">
      {link.label} →
    </a>
  ) : null;
}

/** What came back from a form that changes a record: saved (or saved with a warning), or why not. */
export function FormResult({ state }: { state: ChangeFormState }) {
  if (state.status === "failed") {
    return (
      <>
        <FormError message={state.formError} />
        <ResultLink link={state.link} />
      </>
    );
  }
  if (state.status === "saved") {
    return (
      <>
        <p
          className={state.isWarning ? "text-attention text-sm" : "text-teal text-sm"}
          role="status"
        >
          {state.message}
        </p>
        <ResultLink link={state.link} />
      </>
    );
  }
  return null;
}
