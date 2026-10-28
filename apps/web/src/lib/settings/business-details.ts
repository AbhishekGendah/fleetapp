import { postcodeMatchesState } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  activityLog,
  operators,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

import type { BusinessDetailsInput } from "./business-details-input";

const BUSINESS_DETAIL_FIELDS = [
  "legalName",
  "tradingName",
  "abn",
  "gstRegistered",
  "gstRegisteredFrom",
  "addressLine1",
  "addressLine2",
  "suburb",
  "state",
  "postcode",
  "phone",
  "email",
  "timezone",
] as const satisfies readonly (keyof BusinessDetailsInput)[];

type BusinessDetailField = (typeof BUSINESS_DETAIL_FIELDS)[number];
/** As stored: details saved before they became required may still be blank. */
export type BusinessDetails = Pick<typeof operators.$inferSelect, BusinessDetailField>;

const businessDetailColumns = {
  legalName: operators.legalName,
  tradingName: operators.tradingName,
  abn: operators.abn,
  gstRegistered: operators.gstRegistered,
  gstRegisteredFrom: operators.gstRegisteredFrom,
  addressLine1: operators.addressLine1,
  addressLine2: operators.addressLine2,
  suburb: operators.suburb,
  state: operators.state,
  postcode: operators.postcode,
  phone: operators.phone,
  email: operators.email,
  timezone: operators.timezone,
};

/** The signed-in User's own Operator, and nobody else's: the row is read under its tenant context. */
export async function loadBusinessDetails(
  database: AnyDatabase,
  operatorId: string,
): Promise<BusinessDetails | null> {
  const [row] = await withTenant(database, operatorId, (tx) =>
    tx.select(businessDetailColumns).from(operators).where(eq(operators.id, operatorId)),
  );
  return row ? (row as BusinessDetails) : null;
}

function changedFields(
  before: BusinessDetails,
  after: BusinessDetails,
): { valuesBefore: Partial<BusinessDetails>; valuesAfter: Partial<BusinessDetails> } {
  const changed = BUSINESS_DETAIL_FIELDS.filter((field) => before[field] !== after[field]);
  return {
    valuesBefore: Object.fromEntries(changed.map((field) => [field, before[field]])),
    valuesAfter: Object.fromEntries(changed.map((field) => [field, after[field]])),
  };
}

export interface SaveBusinessDetailsResult {
  /** Saved, but the postcode does not look like one from that state. */
  hasPostcodeWarning: boolean;
}

/**
 * Saves the Operator's business details and logs exactly what changed
 * (rule 19). The Operator comes from the signed-in User, never the form
 * (rule 1). Saving nothing new writes nothing, so the history only shows
 * real changes.
 */
export async function saveBusinessDetails(
  database: AnyDatabase,
  actor: { userId: string; operatorId: string },
  input: BusinessDetailsInput,
): Promise<SaveBusinessDetailsResult> {
  const after: BusinessDetails = Object.fromEntries(
    BUSINESS_DETAIL_FIELDS.map((field) => [field, input[field]]),
  ) as BusinessDetails;

  await withTenant(database, actor.operatorId, async (tx) => {
    const [before] = await tx
      .select(businessDetailColumns)
      .from(operators)
      .where(eq(operators.id, actor.operatorId))
      .for("update");
    if (!before) {
      throw new Error("The Operator was not found.");
    }

    const { valuesBefore, valuesAfter } = changedFields(before as BusinessDetails, after);
    if (Object.keys(valuesAfter).length === 0) {
      return;
    }

    await tx.update(operators).set(after).where(eq(operators.id, actor.operatorId));
    await tx.insert(activityLog).values({
      operatorId: actor.operatorId,
      actorType: "user",
      actorId: actor.userId,
      entityType: ACTIVITY_ENTITY_TYPES.operator,
      entityId: actor.operatorId,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore,
      valuesAfter,
    });
  });

  return {
    hasPostcodeWarning:
      input.postcode !== null &&
      input.state !== null &&
      !postcodeMatchesState(input.postcode, input.state),
  };
}
