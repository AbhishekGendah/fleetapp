import { env } from "../env";
import { appDb } from "./app-db";
import { emailSender } from "./email";
import type { OperatorActionDependencies } from "./operators/dependencies";

export const operatorDependencies: OperatorActionDependencies = {
  database: appDb,
  emailSender,
  appUrl: env.APP_URL,
  now: () => new Date(),
};
