/**
 * The ways an Operator action can be refused. Each message is written to be
 * shown to the Admin as it is.
 */

export class EmailAlreadyInUseError extends Error {
  constructor() {
    super("That email address already has a login. Use a different one.");
    this.name = "EmailAlreadyInUseError";
  }
}

export class OperatorNotFoundError extends Error {
  constructor() {
    super("That Operator does not exist.");
    this.name = "OperatorNotFoundError";
  }
}

export class OperatorSuspendedError extends Error {
  constructor() {
    super("This Operator is suspended. Reactivate it before resending the invite.");
    this.name = "OperatorSuspendedError";
  }
}

export class InviteAlreadyAcceptedError extends Error {
  constructor() {
    super("This invite has already been accepted, so there is nothing to resend.");
    this.name = "InviteAlreadyAcceptedError";
  }
}

export const OPERATOR_ACTION_ERRORS = [
  EmailAlreadyInUseError,
  OperatorNotFoundError,
  OperatorSuspendedError,
  InviteAlreadyAcceptedError,
] as const;

/** True for a refusal the Admin should see, rather than an unexpected fault. */
export function isOperatorActionError(error: unknown): error is Error {
  return OPERATOR_ACTION_ERRORS.some((ErrorClass) => error instanceof ErrorClass);
}
