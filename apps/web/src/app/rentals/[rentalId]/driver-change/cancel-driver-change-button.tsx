import { ActionButton } from "@fleetapp/ui/action-button";
import { XCircle } from "lucide-react";

import { cancelDriverChangeAction } from "./actions";

/** Stops the driver change under way; the driver who has the car keeps it. */
export function CancelDriverChangeButton({ rentalId }: { rentalId: string }) {
  return (
    <ActionButton
      action={cancelDriverChangeAction.bind(null, rentalId)}
      label="Cancel driver change"
      pendingLabel="Cancelling…"
      variant="danger"
      icon={<XCircle aria-hidden />}
      confirm={{
        title: "Cancel this driver change?",
        description:
          "The check-in's photos and damage marks are thrown away, and the driver who has the car keeps it.",
        confirmLabel: "Yes, cancel the change",
        keepLabel: "No, keep the change",
      }}
    />
  );
}
