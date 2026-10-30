import { Button } from "@fleetapp/ui/button";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormResult } from "@fleetapp/ui/form-result";

/** The end of a record's status form: what saving said, then "Save status". */
export function SaveStatusButton(props: {
  state: ChangeFormState;
  isPending: boolean;
  /** False once anything is changed, so an old result stops showing. */
  isResultShown: boolean;
}) {
  return (
    <>
      {props.isResultShown && !props.isPending ? <FormResult state={props.state} /> : null}
      <Button type="submit" variant="outline" disabled={props.isPending} className="sm:self-start">
        {props.isPending ? "Saving…" : "Save status"}
      </Button>
    </>
  );
}
