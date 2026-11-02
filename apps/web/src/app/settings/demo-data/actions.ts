"use server";

import { describeErrorForLog } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { demoContextFor, isDemoDataAllowed } from "../../../lib/demo-data/demo-access";
import { DemoDataError } from "../../../lib/demo-data/demo-context";
import { isDemoStepKey, runDemoStep } from "../../../lib/demo-data/demo-steps";
import { requireUser } from "../../../lib/require-user";

export type DemoStepOutcome =
  { status: "done"; added: number } | { status: "failed"; message: string };

const NOT_ALLOWED_MESSAGE = "Demo data can only be added on the test site.";
const UNEXPECTED_MESSAGE = "Something went wrong in this step. Press the button again to carry on.";

const stepKeySchema = z.string().refine(isDemoStepKey);

/**
 * Runs one demo step for the signed-in User's own business (rule 1: the
 * business comes from the session). Refused anywhere but a test site.
 */
export async function runDemoStepAction(key: unknown): Promise<DemoStepOutcome> {
  const user = await requireUser();
  const parsed = stepKeySchema.safeParse(key);
  if (!isDemoDataAllowed() || !parsed.success) {
    return { status: "failed", message: NOT_ALLOWED_MESSAGE };
  }
  try {
    const added = await runDemoStep(await demoContextFor(user), parsed.data);
    revalidatePath("/", "layout");
    return { status: "done", added };
  } catch (error) {
    // A demo step's own message names only made-up records; any other error's is never shown.
    if (error instanceof DemoDataError) {
      console.error("Demo data step failed", { step: parsed.data, message: error.message });
      return { status: "failed", message: error.message };
    }
    console.error("Demo data step failed", { step: parsed.data, ...describeErrorForLog(error) });
    return { status: "failed", message: UNEXPECTED_MESSAGE };
  }
}
