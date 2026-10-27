import { createEmailSender } from "@fleetapp/email";

import { env } from "../env";
import { appDb } from "./app-db";

export const emailSender = createEmailSender({
  transport: env.EMAIL_TRANSPORT,
  database: appDb,
  from: env.EMAIL_FROM,
});

/** The test inbox page exists only while emails are going into it. */
export const isDevOutboxEnabled = env.EMAIL_TRANSPORT === "dev_outbox";
