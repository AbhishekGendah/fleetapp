import { FormDialog } from "@fleetapp/ui/form-dialog";
import { UserCheck } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { listBusinessChoices } from "../../../lib/rentals/driver-choices";
import { DRIVER_TO_BE_NAMED } from "../../../lib/rentals/rental-input";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { loadExpiryContext } from "../../../lib/vehicles/expiry-context";
import { nameDriverAction } from "./actions";
import { NameDriverForm } from "./name-driver-form";

/** Only a business's draft or booking names its driver here; once out, it is a driver change (slice 4). */
const DRIVER_NAMEABLE = new Set(["draft", "booked"]);

/**
 * "Name a driver" (or "Change driver" once one is named) on a business's
 * draft or booking: the driver picker in a pop-up. None for a person's own
 * rental, or for a business no longer able to book (archived, Do not rent).
 */
export async function NameDriverDialog(props: {
  rental: RentalDetail;
  user: SignedInUser;
  isMainAction?: boolean;
}) {
  const { rental, user } = props;
  if (rental.renterKind !== "organisation" || !DRIVER_NAMEABLE.has(rental.status)) {
    return null;
  }
  const expiry = await loadExpiryContext(user, "licenceExpiryWarningDays");
  const business = (await listBusinessChoices(appDb, user.operatorId, expiry, rental.renterId))[
    rental.renterId
  ];
  if (!business) {
    return null;
  }
  const label = rental.driverId ? "Change driver" : "Name a driver";
  return (
    <FormDialog
      triggerLabel={label}
      title={label}
      triggerIcon={<UserCheck aria-hidden />}
      isMainAction={props.isMainAction}
    >
      <NameDriverForm
        action={nameDriverAction.bind(null, rental.id)}
        businessId={rental.renterId}
        business={business}
        currentValue={rental.driverId ?? DRIVER_TO_BE_NAMED}
      />
    </FormDialog>
  );
}
