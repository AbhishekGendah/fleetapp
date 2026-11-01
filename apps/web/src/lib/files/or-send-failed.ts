import { describeErrorForLog } from "@fleetapp/core";

import { SEND_FAILED_MESSAGE } from "./send-to-storage";

/**
 * Runs the browser's side of an upload (ask, send, confirm), turning a
 * dropped connection or a failed server call into the usual "did not finish"
 * message, so no button is ever left stuck on "Sending…".
 */
export async function orSendFailed(step: () => Promise<string | null>): Promise<string | null> {
  try {
    return await step();
  } catch (error) {
    console.warn("An upload did not finish", describeErrorForLog(error));
    return SEND_FAILED_MESSAGE;
  }
}
