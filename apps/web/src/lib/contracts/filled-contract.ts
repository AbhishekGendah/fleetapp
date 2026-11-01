import {
  fillMergeFields,
  missingMergeFields,
  type ContractData,
  type MergeFieldKey,
  type TemplateDocument,
} from "@fleetapp/core";
import { contentFingerprint } from "@fleetapp/core/server";
import type { AnyDatabase } from "@fleetapp/db/client";

import type { RentalClock } from "../rentals/rental-records";
import { loadContractData } from "./contract-data";

/** A rental's contract text, filled in, with its fingerprint and the fields that have nothing on file. */
export interface FilledContract {
  document: TemplateDocument;
  fingerprint: string;
  data: ContractData;
  missing: MergeFieldKey[];
}

/**
 * The template filled in with the rental's details as of `clock.now` (the
 * moment its link was sent, so "Date of issue" stays put), with the
 * fingerprint of exactly that text. Null if the rental is not the Operator's.
 */
export async function fillContract(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  template: TemplateDocument,
  clock: RentalClock,
): Promise<FilledContract | null> {
  const data = await loadContractData(database, operatorId, rentalId, clock);
  if (!data) {
    return null;
  }
  const document = fillMergeFields(template, data);
  return {
    document,
    fingerprint: contentFingerprint(document),
    data,
    missing: missingMergeFields(template, data),
  };
}
