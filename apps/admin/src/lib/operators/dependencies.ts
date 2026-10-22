import type { AnyDatabase } from "@fleetapp/db/client";
import type { EmailSender } from "@fleetapp/email";

/**
 * What the Operator actions need from outside. Passed in rather than imported,
 * so the tests run the same code against a real database and a recording
 * email sender.
 */
export interface OperatorActionDependencies {
  database: AnyDatabase;
  emailSender: EmailSender;
  /** The Operator app's address, for invite links. */
  appUrl: string;
  now: () => Date;
}

export type Transaction = Parameters<Parameters<AnyDatabase["transaction"]>[0]>[0];
