import { failedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { renterPath } from "../paths";
import type { LicenceOnFile } from "./licence-records";

/** The refusal when another Renter already has the licence, with a way to them. */
export function licenceOnFileState(result: LicenceOnFile): ChangeFormState {
  const message = result.isArchived
    ? "Another Renter, now archived, already has this licence. Restore them rather than adding the same person twice."
    : "Another Renter already has this licence. It may be the same person entered twice.";
  return failedState(
    message,
    result.renterId ? { href: renterPath(result.renterId), label: "Open them" } : undefined,
  );
}
