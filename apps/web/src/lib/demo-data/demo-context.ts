import { addDays, type VehicleCatalogue } from "@fleetapp/core";
import type { EmailSender } from "@fleetapp/email";
import type { z } from "zod";

import type { ActingUser } from "../acting-user";
import type { FileDependencies } from "../files/stored-files";
import type { LinkDependencies } from "../renter-links/details-links";

/** Everything a demo step needs: the signed-in User's business, its clock and the app's services. */
export interface DemoContext {
  deps: FileDependencies & { emailSender: EmailSender };
  actor: ActingUser;
  timeZone: string;
  /** The business's today, YYYY-MM-DD: every demo date is counted from it. */
  today: string;
  catalogue: VehicleCatalogue;
  /** For sending the details form and contract links, by email to the test inbox. */
  links: LinkDependencies;
}

/** A date this many days from the business's today (before it when negative). */
export function dayFrom(context: Pick<DemoContext, "today">, days: number): string {
  return addDays(context.today, days);
}

/** A typed date and time, as the date-and-time boxes send it. */
export function momentText(date: string, time: string): string {
  return `${date}T${time}`;
}

/**
 * A demo step that could not do what the demo data expected. Its message
 * names only made-up records, so unlike other errors it is safe to show
 * and to log.
 */
export class DemoDataError extends Error {
  override name = "DemoDataError";
}

/**
 * Demo records go through the same checks as the forms; one that fails them
 * is a mistake in the demo data itself, so it stops the step with the reason.
 */
export function checkedInput<Output>(result: z.ZodSafeParseResult<Output>, what: string): Output {
  if (!result.success) {
    throw new DemoDataError(`Demo ${what} is not valid: ${result.error.issues[0]?.message ?? ""}`);
  }
  return result.data;
}

/** Stops the step when a save did not do what the demo data expected. */
export function expectSaved(outcome: string, expected: readonly string[], what: string): void {
  if (!expected.includes(outcome)) {
    throw new DemoDataError(`Demo ${what} was not saved: ${outcome}`);
  }
}
