import { describeErrorForLog } from "@fleetapp/core";

import { appDb } from "../app-db";
import { appFileStorage } from "../storage/app-file-storage";
import { findLogoViewUrl } from "./stored-files";

/**
 * A 5-minute link to the Operator's logo, for the page being drawn. A storage
 * outage must not take every page down with it, so a failure shows no logo.
 */
export async function loadOperatorLogoUrl(operatorId: string): Promise<string | null> {
  try {
    return await findLogoViewUrl({ database: appDb, storage: appFileStorage }, operatorId);
  } catch (error) {
    console.error("Loading the Operator's logo failed", describeErrorForLog(error));
    return null;
  }
}
