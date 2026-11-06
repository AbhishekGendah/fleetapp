"use client";

import { FormDialog } from "@fleetapp/ui/form-dialog";
import dynamic from "next/dynamic";

/**
 * Fetched only when the pop-up opens: the form's checks would otherwise
 * nearly double what the Operators list and the home page download.
 */
const NewOperatorForm = dynamic(() =>
  import("./new/new-operator-form").then((loaded) => loaded.NewOperatorForm),
);

/**
 * "New Operator" opens the form in a pop-up (Abhi's A3), as adding things
 * does in the Operator app. Creating it goes to the new business's page,
 * which says whether the invite went. /operators/new still works on its own.
 */
export function NewOperatorButton() {
  return (
    <FormDialog triggerLabel="New Operator" title="New Operator" isMainAction>
      <p className="text-muted-foreground text-sm">
        The person below gets an email with a link to set up their login. Everything else about the
        business, they fill in themselves once signed in.
      </p>
      <NewOperatorForm />
    </FormDialog>
  );
}
