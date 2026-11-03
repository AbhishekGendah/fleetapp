import { catchUpOperator } from "../billing/billing-run";
import type { DemoContext } from "./demo-context";

/** Every demo line is newer than this, so the catch-up looks at all of them. */
const EVERY_LINE_SINCE = new Date("2000-01-01T00:00:00Z");

/**
 * Invoices and receipts for the demo: the handovers' invoices are issued as
 * each car goes out; this issues the payments' receipts and anything else
 * waiting, as the nightly run would. Running it again issues nothing.
 */
export function addDemoDocuments(context: DemoContext): Promise<number> {
  return catchUpOperator(context.deps, context.actor.operatorId, EVERY_LINE_SINCE);
}
