/** The admin app's own pages that other code sends people to. */
export const HOME_PATH = "/";
export const SIGN_IN_PATH = "/sign-in";
export const SET_UP_AUTHENTICATOR_PATH = "/set-up-authenticator";
export const OPERATORS_PATH = "/operators";
export const NEW_OPERATOR_PATH = `${OPERATORS_PATH}/new`;
export const DEV_OUTBOX_PATH = "/dev-outbox";
export const COMPONENTS_PATH = "/components";

export function operatorPath(operatorId: string): string {
  return `${OPERATORS_PATH}/${operatorId}`;
}

export function devOutboxEmailPath(emailId: string): string {
  return `${DEV_OUTBOX_PATH}/${emailId}`;
}
