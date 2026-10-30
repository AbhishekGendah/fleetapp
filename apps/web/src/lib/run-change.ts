import { describeErrorForLog } from "@fleetapp/core";
import { revalidatePath } from "next/cache";

import { failedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import type { ActingUser } from "./acting-user";
import { requireUser, type SignedInUser } from "./require-user";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";

export interface UserChangeRun {
  /** In the log if it fails, e.g. "Adding a rego renewal". Never personal data. */
  description: string;
  /** The pages that show what changed, refreshed afterwards. */
  pagesToRefresh: readonly string[];
  /** `user` is there for what the change needs to know, such as the Operator's timezone. */
  change: (actor: ActingUser, user: SignedInUser) => Promise<ChangeFormState>;
}

/**
 * What every small change on a record's page does around the change itself:
 * signs the User in (the Operator comes from the session, rule 1), refreshes
 * the pages, and turns a failure into a message without showing its details.
 */
export async function runUserChange(run: UserChangeRun): Promise<ChangeFormState> {
  const user = await requireUser();
  try {
    const state = await run.change({ userId: user.id, operatorId: user.operatorId }, user);
    run.pagesToRefresh.forEach((path) => revalidatePath(path));
    return state;
  } catch (error) {
    console.error(`${run.description} failed`, describeErrorForLog(error));
    return failedState(UNEXPECTED_ERROR_MESSAGE);
  }
}
