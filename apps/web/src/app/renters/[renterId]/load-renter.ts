import { isRecordId } from "@fleetapp/core";
import { notFound } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import type { SignedInUser } from "../../../lib/require-user";
import { loadRenter, type RenterDetail } from "../../../lib/renters/renter-queries";

/** The signed-in User's Renter from the page address, or the not-found page. */
export async function loadRenterOrNotFound(
  user: SignedInUser,
  renterId: string,
): Promise<RenterDetail> {
  const renter = isRecordId(renterId) ? await loadRenter(appDb, user.operatorId, renterId) : null;
  if (!renter) {
    notFound();
  }
  return renter;
}
